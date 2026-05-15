import { Component, OnInit, AfterViewInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CommonModule } from "@angular/common";
import { open } from "@tauri-apps/plugin-dialog";
import { Command } from "@tauri-apps/plugin-shell";
import { info, error } from "@tauri-apps/plugin-log";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";

@Component({
  selector: "app-root",
  imports: [FormsModule, CommonModule],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent implements OnInit, AfterViewInit {
  title = "Format Branch Name";

  selectedFolder: string = "";

  dropdownValues: string[] = [];
  selectedDropdownValue: string = "";
  isLoadingBranches: boolean = false;

  // Autocomplete state
  filteredDropdownValues: string[] = [];
  showDropdown: boolean = false;

  nomeBranch: string = "";

  branchType: string = "feature";

  // Guarda todas as branches (locais e remotas) para validação
  allBranches: Set<string> = new Set();

  // Mapeia o nome de exibição para a referência remota (se existir)
  // Isso garante que vamos ramificar do código mais recente da nuvem
  branchBaseMapping: Map<string, string> = new Map();

  // Modals state
  showSettingsDialog: boolean = false;
  showDeleteBranchesDialog: boolean = false;

  // Branches state for deletion
  localBranchesToDelete: { name: string; selected: boolean }[] = [];
  isLoadingLocalBranches: boolean = false;
  isDeletingBranches: boolean = false;

  // UX Improvement: Estado de carregamento na criação
  isCreatingBranch: boolean = false;

  ngOnInit() {
    const savedFolder = localStorage.getItem("lastSelectedFolder");
    if (savedFolder) {
      this.selectedFolder = savedFolder;
      this.loadRemoteBranches(savedFolder);
    }
  }

  ngAfterViewInit() {
    const card = document.querySelector(".card-container");
    const appWrapper = document.querySelector(".app-wrapper");

    if (card && appWrapper) {
      const resizeObserver = new ResizeObserver(async () => {
        // Obtém dinamicamente os valores de padding do wrapper para não usar valores fixos
        const wrapperStyle = globalThis.getComputedStyle(appWrapper);
        const paddingTop = Number.parseFloat(wrapperStyle.paddingTop);
        const paddingBottom = Number.parseFloat(wrapperStyle.paddingBottom);
        const paddingLeft = Number.parseFloat(wrapperStyle.paddingLeft);
        const paddingRight = Number.parseFloat(wrapperStyle.paddingRight);

        // A janela do SO possui bordas e barra de título (Windows/macOS chrome).
        // Se não somarmos essa diferença, a barra de título "roubará" o espaço da interface e cortará o final do App.
        const chromeWidth = Math.max(0, window.outerWidth - window.innerWidth);
        const chromeHeight = Math.max(
          0,
          window.outerHeight - window.innerHeight,
        );

        // Lê a largura projetada do card no CSS para manter a janela sempre perfeita e sem usar números fixos
        const cardStyle = globalThis.getComputedStyle(card);
        const cardMaxWidth = Number.parseFloat(cardStyle.maxWidth);

        const targetInnerWidth =
          (Number.isNaN(cardMaxWidth) ? card.scrollWidth : cardMaxWidth) +
          paddingLeft +
          paddingRight;
        const targetInnerHeight =
          card.scrollHeight + paddingTop + paddingBottom;

        try {
          // Somamos o espaço do "chrome" da janela para garantir que a área útil interna seja exata
          await getCurrentWindow().setSize(
            new LogicalSize(
              targetInnerWidth + chromeWidth,
              targetInnerHeight + chromeHeight,
            ),
          );
        } catch (err) {
          console.error(
            "Falha ao redimensionar a janela nativa via Tauri:",
            err,
          );
        }
      });
      resizeObserver.observe(card);
    }
  }

  async onChooseFolder() {
    try {
      // Abre a janela nativa do sistema para escolher uma pasta
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Selecione o diretório do projeto",
      });

      // Atualiza o valor do input se o usuário selecionou algo
      if (selected !== null && !Array.isArray(selected)) {
        this.selectedFolder = selected;
        localStorage.setItem("lastSelectedFolder", selected);
        await this.loadRemoteBranches(selected);
      }
    } catch (err) {
      error(`Erro ao abrir a janela de seleção: ${err}`);
    }
  }

  async loadRemoteBranches(directory: string) {
    // Guarda a seleção atual para não apagar a interface do usuário ao recarregar
    const previousSelection = this.selectedDropdownValue;

    this.isLoadingBranches = true;
    this.dropdownValues = [];
    this.filteredDropdownValues = [];
    this.selectedDropdownValue = "";
    this.allBranches.clear();
    this.branchBaseMapping.clear();

    try {
      // RESILIÊNCIA: Verifica se é um repositório git válido antes de executar os comandos pesados
      const statusCmd = Command.create("git", ["status"], { cwd: directory });
      const statusOutput = await statusCmd.execute();

      if (statusOutput.code !== 0) {
        alert("A pasta selecionada não parece ser um repositório Git válido.");
        this.selectedFolder = "";
        localStorage.removeItem("lastSelectedFolder");
        return;
      }

      // 1. Faz o fetch das branches remotas e faz prune de apagadas
      // Ao fazer isso, o Git baixa todas as atualizações da nuvem para o computador.
      const fetchCmd = Command.create("git", ["fetch", "--all", "--prune"], {
        cwd: directory,
      });
      await fetchCmd.execute();

      // 2. Lista TODAS as branches (locais e remotas)
      const allBranchesCmd = Command.create("git", ["branch", "-a"], {
        cwd: directory,
      });
      const allBranchesOutput = await allBranchesCmd.execute();

      if (allBranchesOutput.code === 0) {
        const rawBranches = allBranchesOutput.stdout
          .split("\n")
          // Remove o asterisco da branch atual e espaços em branco
          .map((b) => b.replace(/^\*?\s+/, "").trim())
          .filter((b) => b.length > 0 && !b.includes("->"));

        // Se o repo existir mas estiver completamente sem commits (rawBranches vazio)
        if (rawBranches.length === 0) {
          alert("Repositório vazio. Faça seu primeiro commit para gerenciar branches.");
          // Não resetamos o selectedFolder agressivamente aqui.
          return;
        }

        rawBranches.forEach((original) => {
          let cleanName = original;

          // Limpa "remotes/origin/branch-name" para "branch-name"
          if (original.startsWith("remotes/")) {
            const parts = original.split("/");
            parts.splice(0, 2); // Remove 'remotes' e o nome do remote
            cleanName = parts.join("/");
          }

          this.allBranches.add(cleanName);

          // guarda o map de nome simplificado pra o remote, se tiver
          if (
            !this.branchBaseMapping.has(cleanName) ||
            original.startsWith("remotes/")
          ) {
            this.branchBaseMapping.set(cleanName, original);
          }
        });

        const remotas = Array.from(this.allBranches).filter((branch) =>
          this.branchBaseMapping.get(branch)?.startsWith("remotes/"),
        );

        // Atualiza a lista do dropdown SOMENTE com as branches remotas (sem fallback)
        this.dropdownValues = remotas;
        this.filteredDropdownValues = [...remotas];

        // Restaura a seleção se ela ainda existir na nova lista atualizada
        this.selectedDropdownValue = remotas.includes(previousSelection)
          ? previousSelection
          : "";
      } else {
        error(`Erro ao listar branches: ${allBranchesOutput.stderr}`);
        alert("Erro ao listar as branches do repositório Git.");
        this.selectedFolder = ""; // Reseta o folder apenas em falha catastrófica e inesperada
        localStorage.removeItem("lastSelectedFolder");
      }
    } catch (err) {
      error(`Erro ao executar comandos git: ${err}`);
      alert(
        "Ocorreu um erro ao tentar executar o Git. Verifique sua conexão com a internet e se a pasta é um repositório.",
      );
      this.selectedFolder = "";
      localStorage.removeItem("lastSelectedFolder");
    } finally {
      this.isLoadingBranches = false;
    }
  }

  // Settings & Delete Branches Logic
  openSettings() {
    this.showSettingsDialog = true;
  }

  closeSettings() {
    this.showSettingsDialog = false;
  }

  async openDeleteBranches() {
    if (!this.selectedFolder) {
      alert("Selecione um projeto primeiro!");
      return;
    }

    this.showSettingsDialog = false;
    this.showDeleteBranchesDialog = true;
    this.isLoadingLocalBranches = true;
    this.localBranchesToDelete = [];

    try {
      // Executa git branch para listar apenas branches locais
      const localBranchesCmd = Command.create("git", ["branch"], {
        cwd: this.selectedFolder,
      });
      const output = await localBranchesCmd.execute();

      if (output.code === 0) {
        const branches = output.stdout
          .split("\n")
          // Filtra linhas em branco
          .filter((b) => b.trim().length > 0)
          // Filtra a branch atual que começa com asterisco '*' (eq. grep -v '^*')
          .filter((b) => !b.trim().startsWith("*"))
          .map((b) => ({
            name: b.trim(),
            selected: false,
          }));

        this.localBranchesToDelete = branches;
      } else {
        alert("Erro ao ler as branches locais.");
      }
    } catch (err) {
      error(`Falha ao executar o comando git (listar locais): ${err}`);
      alert("Falha ao executar o comando git.");
    } finally {
      this.isLoadingLocalBranches = false;
    }
  }

  closeDeleteBranches() {
    this.showDeleteBranchesDialog = false;
  }

  async deleteSelectedBranches() {
    const branchesToDelete = this.localBranchesToDelete
      .filter((b) => b.selected)
      .map((b) => b.name);

    if (branchesToDelete.length === 0) {
      alert("Selecione pelo menos uma branch para apagar.");
      return;
    }

    // Confirmação para evitar desastres
    if (
      !confirm(
        `Tem certeza que deseja apagar ${branchesToDelete.length} branch(es) local(is)?`,
      )
    ) {
      return;
    }

    this.isDeletingBranches = true;

    try {
      // Executa git branch -D branch1 branch2 ...
      const deleteCmd = Command.create(
        "git",
        ["branch", "-D", ...branchesToDelete],
        { cwd: this.selectedFolder },
      );
      const output = await deleteCmd.execute();

      if (output.code === 0) {
        alert("Branches apagadas com sucesso!");
        // Fecha o modal e atualiza a lista se a pessoa quiser abrir de novo
        this.closeDeleteBranches();
        // Atualiza as branches no dropdown principal silenciosamente
        this.loadRemoteBranches(this.selectedFolder);
      } else {
        alert(`Ocorreram erros ao apagar algumas branches:\n${output.stderr}`);
        // Atualiza a lista pra mostrar o que sobrou
        this.openDeleteBranches();
      }
    } catch (err) {
      error(`Erro ao deletar branches: ${err}`);
      alert("Ocorreu um erro ao tentar executar o comando de exclusão.");
    } finally {
      this.isDeletingBranches = false;
    }
  }

  // Função centralizada para limpar strings com a mesma regra da branch
  cleanStringForBranch(text: string): string {
    if (!text) return "";
    return text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, '')
      .toLowerCase();
  }

  // Autocomplete methods
  filterBranches() {
    this.showDropdown = true;

    // Aproveita a lógica de limpeza centralizada!
    const search = this.cleanStringForBranch(this.selectedDropdownValue);

    this.filteredDropdownValues = this.dropdownValues.filter((b) =>
      b.toLowerCase().includes(search)
    );
  }

  selectBranch(branch: string) {
    this.selectedDropdownValue = branch;
    this.showDropdown = false;
  }

  hideDropdown() {
    this.showDropdown = false;
  }

  get isBranchPaiValid(): boolean {
    if (!this.selectedDropdownValue) return false;
    // O valor deve ser exatamente uma das branches disponíveis
    return this.dropdownValues.includes(this.selectedDropdownValue);
  }

  // Gera o nome da branch formatado
  get formattedBranchName(): string {
    if (!this.nomeBranch) return "";

    // Reaproveita o método base de limpeza
    const cleanText = this.cleanStringForBranch(this.nomeBranch);

    return `${this.branchType}/${cleanText}`;
  }

  // Valida se, após a limpeza de caracteres, sobrou algum nome real para a branch
  get isGeneratedNameValid(): boolean {
    if (!this.nomeBranch) return false;

    const parts = this.formattedBranchName.split("/");
    return parts.length > 1 && parts[1].trim().length > 0;
  }

  // Verifica se o nome da branch já existe
  get isBranchNameTaken(): boolean {
    if (!this.nomeBranch || !this.formattedBranchName) return false;

    const targetName = this.formattedBranchName; // lowercase
    return Array.from(this.allBranches).some(
      (branch) => branch.toLowerCase() === targetName,
    );
  }

  // Otimização de performance para o Angular
  trackByName(index: number, item: any): string {
    return typeof item === 'string' ? item : item.name;
  }

  async onSubmit() {
    if (
      !this.selectedFolder ||
      !this.selectedDropdownValue ||
      !this.nomeBranch ||
      !this.branchType
    ) {
      alert("Por favor, preencha todos os campos antes de continuar.");
      return;
    }

    if (!this.isBranchPaiValid) {
      alert(
        "A Branch Pai selecionada não é válida. Por favor, selecione uma da lista.",
      );
      return;
    }

    if (this.isBranchNameTaken) {
      alert("Este nome de branch já está em uso!");
      return;
    }

    // UX Improvement: Indicador Visual de Criação
    this.isCreatingBranch = true;

    const branchName = this.formattedBranchName;

    // Pega a referência real da branch pai (se for remota, usa a versão do remote)
    const baseBranchForCheckout =
      this.branchBaseMapping.get(this.selectedDropdownValue) ||
      this.selectedDropdownValue;

    info(
      `Tentando criar branch: ${branchName} a partir de ${baseBranchForCheckout}`,
    );

    try {
      // Cria a nova branch a partir da branch pai selecionada
      // git checkout --no-track -b <nome-da-branch> <branch-pai>
      const createBranchCmd = Command.create(
        "git",
        ["checkout", "--no-track", "-b", branchName, baseBranchForCheckout],
        { cwd: this.selectedFolder },
      );
      const output = await createBranchCmd.execute();

      if (output.code === 0) {
        info(
          `Branch '${branchName}' criada com sucesso a partir de '${baseBranchForCheckout}'`,
        );

        let copied = false;
        try {
          // Copia para o clipboard (agora usando o plugin oficial tauri-plugin-clipboard-manager)
          await writeText(branchName);
          copied = true;
        } catch (clipboardErr) {
          error(
            `Aviso: não foi possível copiar para o clipboard: ${clipboardErr}`,
          );
        }

        if (copied) {
          alert(
            `Branch '${branchName}' criada! Já troquei de branch para você (e tá no clipboard tbm)!`,
          );
        } else {
          alert(
            `Branch '${branchName}' criada! Já troquei de branch para você!`,
          );
        }

        // Limpa o formulário e atualiza o estado
        this.nomeBranch = "";
        await this.loadRemoteBranches(this.selectedFolder);
      } else {
        error(`Erro ao criar branch: ${output.stderr}`);

        // UX Improvement: Tratamento amigo de erro comum do Git
        if (output.stderr.includes("Please commit your changes or stash them")) {
            alert(`Criação Interrompida: Você tem alterações não salvas que causam conflito ao trocar de branch.\n\nPor favor, salve seu trabalho (faça um commit ou stash) na branch atual antes de tentar novamente.`);
        } else {
            alert(`Erro ao criar branch:\n${output.stderr}`);
        }
      }
    } catch (err) {
      error(`Erro ao executar comando git checkout: ${err}`);
      alert("Ocorreu um erro ao tentar criar a branch.");
    } finally {
      // Desativa o indicador visual quando encerra o processo independente de sucesso ou falha
      this.isCreatingBranch = false;
    }
  }
}
