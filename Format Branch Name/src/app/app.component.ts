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
import { info, error, warn } from "@tauri-apps/plugin-log";
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
  allBranchesLower: Set<string> = new Set();

  // Mapeia o nome de exibição para a referência remota (se existir)
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
  private resizeTimeout?: ReturnType<typeof setTimeout>; // Armazena o timer do debounce
  private hideDropdownTimeout?: ReturnType<typeof setTimeout>;

  // Evita loops infinitos de redimensionamento da janela
  private lastAppliedWidth: number = 0;
  private lastAppliedHeight: number = 0;

  ngOnInit() {
    const savedFolder = this.getSavedFolder();
    if (savedFolder) {
      this.selectedFolder = savedFolder;
      this.loadRemoteBranches(savedFolder);
    }
  }

  ngAfterViewInit() {
    const card = this.cardContainer?.nativeElement;
    const appWrapper = this.appWrapper?.nativeElement;

    if (card && appWrapper) {
      this.resizeObserver = new ResizeObserver(() => {
        // Debounce: Limpa o timer anterior se a função foi chamada novamente rápido demais
        if (this.resizeTimeout) clearTimeout(this.resizeTimeout);

        this.resizeTimeout = setTimeout(async () => {
          // Obtém dinamicamente os valores de padding do wrapper para não usar valores fixos
          const wrapperStyle = globalThis.getComputedStyle(appWrapper);
          const paddingTop = Number.parseFloat(wrapperStyle.paddingTop) || 0;
          const paddingBottom =
            Number.parseFloat(wrapperStyle.paddingBottom) || 0;
          const paddingLeft = Number.parseFloat(wrapperStyle.paddingLeft) || 0;
          const paddingRight =
            Number.parseFloat(wrapperStyle.paddingRight) || 0;

          // A janela do SO possui bordas e barra de título (Windows/macOS chrome).
          // Se não somarmos essa diferença, a barra de título "roubará" o espaço da interface e cortará o final do App.
          const chromeWidth = Math.max(
            0,
            window.outerWidth - window.innerWidth,
          );
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
            const finalWidth = targetInnerWidth + chromeWidth;
            const finalHeight = targetInnerHeight + chromeHeight;

            // Aplica a tolerância de 1px para evitar loops infinitos (jittering)
            if (
              Math.abs(this.lastAppliedWidth - finalWidth) > 1 ||
              Math.abs(this.lastAppliedHeight - finalHeight) > 1
            ) {
              this.lastAppliedWidth = finalWidth;
              this.lastAppliedHeight = finalHeight;

              await getCurrentWindow().setSize(
                new LogicalSize(finalWidth, finalHeight),
              );
            }
          } catch (err) {
            console.error(
              "Falha ao redimensionar a janela nativa via Tauri:",
              err,
            );
          }
        }, 50); // Aguarda 50ms após a última mudança visual para redimensionar a janela
      });
      this.resizeObserver.observe(card);
    }
  }

  ngOnDestroy() {
    this.resizeObserver?.disconnect();
    if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
    if (this.hideDropdownTimeout) clearTimeout(this.hideDropdownTimeout);
  }

  // --- Utilitários Seguros de Local Storage ---
  private getSavedFolder(): string | null {
    try {
      return localStorage.getItem("lastSelectedFolder");
    } catch (e) {
      warn("Acesso ao localStorage negado: " + e);
      return null;
    }
  }

  private saveFolder(folder: string): void {
    try {
      localStorage.setItem("lastSelectedFolder", folder);
    } catch (e) {
      warn("Acesso ao localStorage negado: " + e);
    }
  }

  private clearSavedFolder(): void {
    try {
      localStorage.removeItem("lastSelectedFolder");
    } catch (e) {
      warn("Acesso ao localStorage negado: " + e);
    }
  }

  protected async onChooseFolder() {
    if (
      this.isLoadingBranches ||
      this.isCreatingBranch ||
      this.isDeletingBranches ||
      this.showDeleteBranchesDialog ||
      this.showSettingsDialog
    ) {
      return;
    }

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
        this.saveFolder(selected);
        await this.loadRemoteBranches(selected);
      }
    } catch (err) {
      error(`Erro ao abrir a janela de seleção: ${err}`);
    }
  }

  private async loadRemoteBranches(directory: string) {
    // Guarda a seleção atual para não apagar a interface do usuário ao recarregar
    const previousSelection = this.selectedDropdownValue;

    this.isLoadingBranches = true;
    this.dropdownValues = [];
    this.filteredDropdownValues = [];
    this.selectedDropdownValue = "";
    this.allBranches.clear();
    this.allBranchesLower.clear();
    this.branchBaseMapping.clear();

    try {
      // Verifica se é um repositório git válido antes de executar os comandos pesados
      const statusCmd = Command.create("git", ["status"], {
        cwd: directory,
        env: { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
      });
      const statusOutput = await statusCmd.execute();

      if (statusOutput.code !== 0) {
        await message(
          "A pasta selecionada não parece ser um repositório Git válido.",
          { title: "Aviso", kind: "warning" },
        );
        this.selectedFolder = "";
        this.clearSavedFolder();
        return;
      }

      await this.fetchAndPrune(directory);
      const rawBranches = await this.getAllGitBranches(directory);
      if (rawBranches === null) return; // Erro já foi tratado em getAllGitBranches
      if (rawBranches.length === 0) {
        await message(
          "Repositório vazio. Faça seu primeiro commit para gerenciar branches.",
          { title: "Aviso", kind: "warning" },
        );
        return;
      }
      this.processBranches(rawBranches, previousSelection);
    } catch (err) {
      error(`Erro ao executar comandos git: ${err}`);
      await message(
        "Ocorreu um erro ao executar o Git. Verifique se o Git está instalado na sua máquina, se a pasta é um repositório válido e sua conexão com a internet.",
        { title: "Erro", kind: "error" },
      );
      this.selectedFolder = "";
      this.clearSavedFolder();
    } finally {
      this.isLoadingBranches = false;
    }
  }

  private async fetchAndPrune(directory: string): Promise<void> {
    const fetchCmd = Command.create("git", ["fetch", "--all", "--prune"], {
      cwd: directory,
      env: {
        LC_ALL: "C",
        GIT_TERMINAL_PROMPT: "0",
        GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
      },
    });
    const output = await fetchCmd.execute();

    if (output.code !== 0) {
      warn(
        `Falha ao sincronizar com o repositório remoto (modo offline ou auth pendente).\nErro: ${output.stderr}`,
      );
      await message(
        `Falha ao sincronizar com o repositório remoto.\nErro: ${output.stderr}`,
        { title: "Erro", kind: "warning" },
      );
    }
  }

  private async getAllGitBranches(directory: string): Promise<string[] | null> {
    const allBranchesCmd = Command.create(
      "git",
      ["-c", "core.quotePath=false", "branch", "-a", "--no-color"],
      {
        cwd: directory,
        env: { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
      },
    );
    const output = await allBranchesCmd.execute();

    if (output.code === 0) {
      return output.stdout
        .split("\n")
        .map((b) => b.replace(/^[*+]?\s+/, "").trim())
        .filter((b) => b.length > 0 && !b.includes("->"));
    }

    error(`Erro ao listar branches: ${output.stderr}`);
    await message(
      `Erro ao listar as branches do repositório Git:\n\n${output.stderr || "Verifique os logs."}`,
      {
        title: "Erro",
        kind: "error",
      },
    );
    this.selectedFolder = "";
    this.clearSavedFolder();
    return null;
  }

  private processBranches(
    rawBranches: string[],
    previousSelection: string,
  ): void {
    rawBranches.forEach((original) => {
      let cleanName = original;
      const isRemote = original.startsWith("remotes/");

      if (isRemote) {
        const parts = original.split("/");
        parts.splice(0, 2);
        cleanName = parts.join("/");
      }

      this.allBranches.add(cleanName);
      this.allBranchesLower.add(cleanName.toLowerCase());

      if (isRemote) {
        const existing = this.branchBaseMapping.get(cleanName);
        if (!existing?.startsWith("remotes/origin/")) {
          this.branchBaseMapping.set(cleanName, original);
        }
      }
    });

    // Garante que o dropdown exiba única e exclusivamente as branches remotas mapeadas
    const remotas = Array.from(this.branchBaseMapping.keys());

    this.dropdownValues = remotas;

    this.selectedDropdownValue = remotas.includes(previousSelection)
      ? previousSelection
      : "";

    if (this.selectedDropdownValue) {
      this.filterBranches();
    } else {
      this.filteredDropdownValues = [...remotas];
    }
  }

  // Settings & Delete Branches Logic
  protected openSettings() {
    this.showSettingsDialog = true;
  }

  protected closeSettings() {
    this.showSettingsDialog = false;
  }

  protected async openDeleteBranches() {
    if (
      this.isLoadingLocalBranches ||
      this.isDeletingBranches ||
      this.isLoadingBranches
    ) {
      return;
    }

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
      const localBranchesCmd = Command.create(
        "git",
        ["-c", "core.quotePath=false", "branch", "--no-color"],
        {
          cwd: this.selectedFolder,
          env: { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
        },
      );
      const output = await localBranchesCmd.execute();

      if (output.code === 0) {
        const branches = output.stdout
          .split("\n")
          // Filtra linhas em branco
          .filter((b) => b.trim().length > 0)
          // Ignora a branch ativa ('*') e worktrees vinculados ('+'). O Git proíbe a exclusão de ambos.
          .filter((b) => {
            const clean = b.trim();
            return !clean.startsWith("*") && !clean.startsWith("+");
          })
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

  protected closeDeleteBranches() {
    this.showDeleteBranchesDialog = false;
  }

  protected async deleteSelectedBranches() {
    if (this.isDeletingBranches) return;

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

    this.isDeletingBranches = true;

    try {
      // Confirmação para evitar desastres
      const isConfirmed = await tauriConfirm(
        `Tem certeza que deseja apagar ${branchesToDelete.length} branch(es) local(is)?`,
        { title: "Confirmação", kind: "warning" },
      );
      if (!isConfirmed) {
        return;
      }

      let hasErrors = false;
      let combinedStderr = "";
      const chunkSize = 50; // Previne o erro E2BIG de limite de comprimento do console no SO

      for (let i = 0; i < branchesToDelete.length; i += chunkSize) {
        const chunk = branchesToDelete.slice(i, i + chunkSize);
        const deleteCmd = Command.create(
          "git",
          ["branch", "-D", "--", ...chunk],
          {
            cwd: this.selectedFolder,
            env: { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
          },
        );
        const output = await deleteCmd.execute();

        if (output.code !== 0) {
          hasErrors = true;
          combinedStderr += output.stderr + "\n";
        }
      }

      if (hasErrors) {
        await message(
          `Ocorreram erros ao apagar algumas branches:\n${combinedStderr}`,
          { title: "Erro", kind: "error" },
        );

        this.isDeletingBranches = false;

        await this.openDeleteBranches();

        await this.loadRemoteBranches(this.selectedFolder);
      } else {
        await message("Branches apagadas com sucesso!", {
          title: "Sucesso",
          kind: "info",
        });
        // Fecha o modal e atualiza a lista se a pessoa quiser abrir de novo
        this.closeDeleteBranches();
        // Recarrega o estado para limpar as branches locais deletadas da memória (this.allBranches)
        await this.loadRemoteBranches(this.selectedFolder);
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

  private cleanStringForBranch(text: string): string {
    if (!text) return "";
    return (
      text
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .replace(/[^\w\s\-/.]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-")
        // Garante que não haja múltiplas barras e retira barras/hífens sobrando nas bordas
        .replace(/\/+/g, "/")
        // Git proíbe sequências de pontos (ex: ..)
        .replace(/\.{2,}/g, ".")
        // O Git não aceita componentes da branch que começam com hífen (ex: feature/-teste)
        .replace(/-?\/-?/g, "/")
        // O Git não aceita componentes da branch que iniciam com ponto (ex: feature/.teste)
        .replace(/\/\.+/g, "/")
        .replace(/^[-/.]+|[-/.]+$/g, "")
        .toLowerCase()
        // Git não permite nomes de branch terminando com .lock
        .replace(/(?:\.lock)+$/g, "")
    );
  }

  // Autocomplete methods
  protected filterBranches() {
    if (this.hideDropdownTimeout) {
      clearTimeout(this.hideDropdownTimeout);
    }
    this.showDropdown = true;

    const searchTerm = (this.selectedDropdownValue || "").trim().toLowerCase();

    if (!searchTerm) {
      this.filteredDropdownValues = [...this.dropdownValues];
      return;
    }
    this.filteredDropdownValues = this.dropdownValues.filter((v) =>
      v.toLowerCase().includes(searchTerm),
    );
  }

  protected selectBranch(branch: string) {
    if (this.hideDropdownTimeout) {
      clearTimeout(this.hideDropdownTimeout);
    }
    this.selectedDropdownValue = branch;
    this.showDropdown = false;
    this.filterBranches(); // Recalcula o filtro para alinhar os estados
  }

  protected hideDropdown() {
    // Aguarda o processamento de possíveis eventos de click nas opções do Dropdown
    // antes de destruí-lo do DOM através do evento `blur`.
    if (this.hideDropdownTimeout) {
      clearTimeout(this.hideDropdownTimeout);
    }
    this.hideDropdownTimeout = setTimeout(() => {
      this.showDropdown = false;
    }, 250); // Aumentado para 250ms para evitar interrupções de cliques um pouco mais lentos
  }

  protected get isBranchPaiValid(): boolean {
    if (!this.selectedDropdownValue) return false;

    return this.dropdownValues.includes(this.selectedDropdownValue);
  }

  protected get formattedBranchName(): string {
    if (!this.nomeBranch) return "";

    const cleanText = this.cleanStringForBranch(this.nomeBranch);

    return `${this.branchType}/${cleanText}`;
  }

  protected get isGeneratedNameValid(): boolean {
    if (!this.nomeBranch) return false;

    const cleanText = this.cleanStringForBranch(this.nomeBranch);
    return cleanText.length > 0;
  }

  // Verifica se o nome da branch já existe
  protected get isBranchNameTaken(): boolean {
    if (!this.nomeBranch || !this.formattedBranchName) return false;

    const targetName = this.formattedBranchName; // lowercase
    return this.allBranchesLower.has(targetName);
  }

  async onSubmit() {
    // Previne envio múltiplo caso o usuário clique duas vezes rapidamente
    if (
      this.isCreatingBranch ||
      this.isLoadingBranches ||
      this.isDeletingBranches
    ) {
      return;
    }

    if (!(await this.isFormValid())) {
      return;
    }

    if (this.isBranchNameTaken) {
      await message("Este nome de branch já está em uso!", {
        title: "Aviso",
        kind: "warning",
      });
      return;
    }

    this.isCreatingBranch = true;

    try {
      const branchName = this.formattedBranchName;

      // Pega a referência real da branch pai (se for remota, usa a versão do remote)
      const baseBranchForCheckout =
        this.branchBaseMapping.get(this.selectedDropdownValue) ||
        this.selectedDropdownValue;

      info(
        `Tentando criar branch: ${branchName} a partir de ${baseBranchForCheckout}`,
      );

      const copied = await this.copyToClipboard(branchName);
      const mudarDeBranch = await this.confirmBranchChange(branchName, copied);

      if (mudarDeBranch) {
        const success = await this.createBranch(
          branchName,
          baseBranchForCheckout,
        );
        if (success) {
          this.nomeBranch = "";
          await this.loadRemoteBranches(this.selectedFolder);
        }
      } else {
        this.nomeBranch = "";
      }
    } finally {
      this.isCreatingBranch = false;
    }
  }

  private async isFormValid(): Promise<boolean> {
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
      return false;
    }

    if (!this.isGeneratedNameValid) {
      await message(
        "O nome da branch gerado é inválido. Utilize caracteres alfanuméricos.",
        {
          title: "Aviso",
          kind: "warning",
        },
      );
      return false;
    }

    if (!this.isBranchPaiValid) {
      await message(
        "A Branch Pai selecionada não é válida. Por favor, selecione uma da lista.",
        { title: "Aviso", kind: "warning" },
      );
      return false;
    }

    return true;
  }

  private async copyToClipboard(text: string): Promise<boolean> {
    try {
      await writeText(text);
      return true;
    } catch (clipboardErr) {
      error(`Aviso: não foi possível copiar para o clipboard: ${clipboardErr}`);
      return false;
    }
  }

  private async confirmBranchChange(
    branchName: string,
    copied: boolean,
  ): Promise<boolean> {
    const messageText = copied
      ? `Posso mudar de branch para você? "${branchName}" já tá no clipboard tbm.`
      : `Posso mudar de branch para você? Se não quiser, digite manualmente o nome: "${branchName}"`;

    return ask(messageText, { title: "Mudar de branch", kind: "info" });
  }

  private async createBranch(
    branchName: string,
    baseBranch: string,
  ): Promise<boolean> {
    try {
      const createBranchCmd = Command.create(
        "git",
        ["checkout", "--no-track", "-b", branchName, baseBranch],
        {
          cwd: this.selectedFolder,
          env: { LC_ALL: "C", GIT_TERMINAL_PROMPT: "0" },
        },
      );
      const output = await createBranchCmd.execute();

      if (output.code === 0) {
        info(
          `Branch '${branchName}' criada com sucesso a partir de '${baseBranch}'`,
        );
        return true;
      } else {
        await this.handleCreateBranchError(output.stderr);
        return false;
      }
    } catch (err) {
      error(`Erro ao executar comando git checkout: ${err}`);
      await message("Ocorreu um erro ao tentar criar a branch.", {
        title: "Erro",
        kind: "error",
      });
      return false;
    }
  }

  private async handleCreateBranchError(stderr: string): Promise<void> {
    error(`Erro ao criar branch: ${stderr}`);
    if (stderr.includes("Please commit your changes or stash them")) {
      await message(
        `Criação Interrompida: Você tem alterações não salvas que causam conflito ao trocar de branch.\n\nPor favor, salve seu trabalho (faça um commit ou stash) na branch atual antes de tentar novamente.`,
        { title: "Aviso", kind: "warning" },
      );
    } else {
      await message(`Erro ao criar branch:\n${stderr}`, {
        title: "Erro",
        kind: "error",
      });
    }
  }
}
