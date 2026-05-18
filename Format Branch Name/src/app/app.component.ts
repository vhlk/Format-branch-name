import {
  Component,
  OnInit,
  AfterViewInit,
  OnDestroy,
  ViewChild,
  ElementRef,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { CommonModule } from "@angular/common";
import {
  open,
  message,
  ask,
  confirm as tauriConfirm,
} from "@tauri-apps/plugin-dialog";
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
export class AppComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild("cardContainer") cardContainer!: ElementRef<HTMLDivElement>;
  @ViewChild("appWrapper") appWrapper!: ElementRef<HTMLElement>;

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

  private resizeObserver?: ResizeObserver;

  ngOnInit() {
    const savedFolder = localStorage.getItem("lastSelectedFolder");
    if (savedFolder) {
      this.selectedFolder = savedFolder;
      this.loadRemoteBranches(savedFolder);
    }
  }

  ngAfterViewInit() {
    const card = this.cardContainer?.nativeElement;
    const appWrapper = this.appWrapper?.nativeElement;

    if (card && appWrapper) {
      this.resizeObserver = new ResizeObserver(async () => {
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
      this.resizeObserver.observe(card);
    }
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
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
      // Verifica se é um repositório git válido antes de executar os comandos pesados
      const statusCmd = Command.create("git", ["status"], { cwd: directory });
      const statusOutput = await statusCmd.execute();

      if (statusOutput.code !== 0) {
        await message(
          "A pasta selecionada não parece ser um repositório Git válido.",
          { title: "Aviso", kind: "warning" },
        );
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
      const allBranchesCmd = Command.create(
        "git",
        ["branch", "-a", "--no-color"],
        {
          cwd: directory,
        },
      );
      const allBranchesOutput = await allBranchesCmd.execute();

      if (allBranchesOutput.code === 0) {
        const rawBranches = allBranchesOutput.stdout
          .split("\n")
          // Remove o asterisco da branch atual e espaços em branco
          .map((b) => b.replace(/^\*?\s+/, "").trim())
          .filter((b) => b.length > 0 && !b.includes("->"));

        // Se o repo existir mas estiver completamente sem commits (rawBranches vazio)
        if (rawBranches.length === 0) {
          await message(
            "Repositório vazio. Faça seu primeiro commit para gerenciar branches.",
            { title: "Aviso", kind: "warning" },
          );
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
        await message("Erro ao listar as branches do repositório Git.", {
          title: "Erro",
          kind: "error",
        });
        this.selectedFolder = ""; // Reseta o folder apenas em falha catastrófica e inesperada
        localStorage.removeItem("lastSelectedFolder");
      }
    } catch (err) {
      error(`Erro ao executar comandos git: ${err}`);
      await message(
        "Ocorreu um erro ao tentar executar o Git. Verifique sua conexão com a internet e se a pasta é um repositório.",
        { title: "Erro", kind: "error" },
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
      await message("Selecione um projeto primeiro!", {
        title: "Aviso",
        kind: "warning",
      });
      return;
    }

    this.showSettingsDialog = false;
    this.showDeleteBranchesDialog = true;
    this.isLoadingLocalBranches = true;
    this.localBranchesToDelete = [];

    try {
      // Executa git branch para listar apenas branches locais
      const localBranchesCmd = Command.create("git", ["branch", "--no-color"], {
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
        await message("Erro ao ler as branches locais.", {
          title: "Erro",
          kind: "error",
        });
      }
    } catch (err) {
      error(`Falha ao executar o comando git (listar locais): ${err}`);
      await message("Falha ao executar o comando git.", {
        title: "Erro",
        kind: "error",
      });
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
      await message("Selecione pelo menos uma branch para apagar.", {
        title: "Aviso",
        kind: "warning",
      });
      return;
    }

    // Confirmação para evitar desastres
    const isConfirmed = await tauriConfirm(
      `Tem certeza que deseja apagar ${branchesToDelete.length} branch(es) local(is)?`,
      { title: "Confirmação", kind: "warning" },
    );
    if (!isConfirmed) {
      return;
    }

    this.isDeletingBranches = true;

    try {
      // Executa git branch -D branch1 branch2 ...
      const deleteCmd = Command.create(
        "git",
        ["branch", "-D", "--", ...branchesToDelete],
        { cwd: this.selectedFolder },
      );
      const output = await deleteCmd.execute();

      if (output.code === 0) {
        await message("Branches apagadas com sucesso!", {
          title: "Sucesso",
          kind: "info",
        });
        // Fecha o modal e atualiza a lista se a pessoa quiser abrir de novo
        this.closeDeleteBranches();
        // Atualiza as branches no dropdown principal silenciosamente
        await this.loadRemoteBranches(this.selectedFolder);
      } else {
        await message(
          `Ocorreram erros ao apagar algumas branches:\n${output.stderr}`,
          { title: "Erro", kind: "error" },
        );
        // Atualiza a lista pra mostrar o que sobrou
        this.openDeleteBranches();
      }
    } catch (err) {
      error(`Erro ao deletar branches: ${err}`);
      await message(
        "Ocorreu um erro ao tentar executar o comando de exclusão.",
        { title: "Erro", kind: "error" },
      );
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
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  }

  // Autocomplete methods
  filterBranches() {
    this.showDropdown = true;

    const lowerName = this.selectedDropdownValue.toLowerCase();
    const cleanName = this.cleanStringForBranch(this.selectedDropdownValue);

    this.filteredDropdownValues = this.dropdownValues.filter((v) => {
      const valueLower = v.toLowerCase();
      const valueClean = this.cleanStringForBranch(v);

      return (
        valueLower.includes(cleanName) ||
        valueLower.includes(lowerName) ||
        valueClean.includes(cleanName) ||
        valueClean.includes(lowerName)
      );
    });
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

  async onSubmit() {
    if (
      !this.selectedFolder ||
      !this.selectedDropdownValue ||
      !this.nomeBranch ||
      !this.branchType
    ) {
      await message("Por favor, preencha todos os campos antes de continuar.", {
        title: "Aviso",
        kind: "warning",
      });
      return;
    }

    if (!this.isBranchPaiValid) {
      await message(
        "A Branch Pai selecionada não é válida. Por favor, selecione uma da lista.",
        { title: "Aviso", kind: "warning" },
      );
      return;
    }

    if (this.isBranchNameTaken) {
      await message("Este nome de branch já está em uso!", {
        title: "Aviso",
        kind: "warning",
      });
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

    let copied = false;
    try {
      // Copia para o clipboard
      await writeText(branchName);
      copied = true;
    } catch (clipboardErr) {
      error(`Aviso: não foi possível copiar para o clipboard: ${clipboardErr}`);
    }

    let mudarDeBranch = true;

    if (copied) {
      mudarDeBranch = await ask(
        `Posso mudar de branch para você? ${branchName} já tá no clipboard tbm.`,
        {
          title: "Mudar de branch",
          kind: "warning",
        },
      );
    } else {
      mudarDeBranch = await ask(
        `Posso mudar de branch para você? Se não quiser, digite manualmente o nome: ${branchName}`,
        {
          title: "Mudar de branch",
          kind: "warning",
        },
      );
    }

    if (mudarDeBranch) {
      try {
        // git checkout --no-track -b <nome-da-branch> <branch-pai> (env: { LC_ALL: "C" } vai forçar inglês)
        const createBranchCmd = Command.create(
          "git",
          ["checkout", "--no-track", "-b", branchName, baseBranchForCheckout],
          { cwd: this.selectedFolder, env: { LC_ALL: "C" } },
        );
        const output = await createBranchCmd.execute();

        if (output.code === 0) {
          info(
            `Branch '${branchName}' criada com sucesso a partir de '${baseBranchForCheckout}'`,
          );
        } else {
          error(`Erro ao criar branch: ${output.stderr}`);

          if (
            output.stderr.includes("Please commit your changes or stash them")
          ) {
            await message(
              `Criação Interrompida: Você tem alterações não salvas que causam conflito ao trocar de branch.\n\nPor favor, salve seu trabalho (faça um commit ou stash) na branch atual antes de tentar novamente.`,
              { title: "Aviso", kind: "warning" },
            );
          } else {
            await message(`Erro ao criar branch:\n${output.stderr}`, {
              title: "Erro",
              kind: "error",
            });
          }
        }
      } catch (err) {
        error(`Erro ao executar comando git checkout: ${err}`);
        await message("Ocorreu um erro ao tentar criar a branch.", {
          title: "Erro",
          kind: "error",
        });
      }
    }

    this.nomeBranch = "";
    await this.loadRemoteBranches(this.selectedFolder);

    this.isCreatingBranch = false;
  }
}
