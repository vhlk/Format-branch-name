import { Component } from "@angular/core";
import { RouterOutlet } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { CommonModule } from "@angular/common";
import { open } from "@tauri-apps/plugin-dialog";
import { Command } from "@tauri-apps/plugin-shell";
import { info, error } from "@tauri-apps/plugin-log";
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

@Component({
  selector: "app-root",
  imports: [FormsModule, CommonModule],
  templateUrl: "./app.component.html",
  styleUrl: "./app.component.css",
})
export class AppComponent {
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
  localBranchesToDelete: { name: string, selected: boolean }[] = [];
  isLoadingLocalBranches: boolean = false;
  isDeletingBranches: boolean = false;

  async onChooseFolder() {
    try {
      // Abre a janela nativa do sistema para escolher uma pasta
      const selected = await open({
        directory: true,
        multiple: false,
        title: 'Selecione o diretório do projeto',
      });

      // Atualiza o valor do input se o usuário selecionou algo
      if (selected !== null && !Array.isArray(selected)) {
        this.selectedFolder = selected;
        await this.loadRemoteBranches(selected);
      }
    } catch (err) {
      error(`Erro ao abrir a janela de seleção: ${err}`);
    }
  }

  async loadRemoteBranches(directory: string) {
    this.isLoadingBranches = true;
    this.dropdownValues = [];
    this.filteredDropdownValues = [];
    this.selectedDropdownValue = "";
    this.allBranches.clear();
    this.branchBaseMapping.clear();

    try {
      // 1. Faz o fetch das branches remotas e faz prune de apagadas
      // Ao fazer isso, o Git baixa todas as atualizações da nuvem para o computador.
      const fetchCmd = Command.create('git', ['fetch', '--all', '--prune'], { cwd: directory });
      await fetchCmd.execute();

      // 2. Lista TODAS as branches (locais e remotas)
      const allBranchesCmd = Command.create('git', ['branch', '-a'], { cwd: directory });
      const allBranchesOutput = await allBranchesCmd.execute();

      if (allBranchesOutput.code === 0) {
        const rawBranches = allBranchesOutput.stdout
          .split('\n')
          // Remove o asterisco da branch atual e espaços em branco
          .map(b => b.replace(/^\*?\s+/, '').trim())
          .filter(b => b.length > 0 && !b.includes('->'));

        rawBranches.forEach(original => {
             let cleanName = original;

             // Limpa "remotes/origin/branch-name" para "branch-name"
             if (original.startsWith('remotes/')) {
               const parts = original.split('/');
               parts.splice(0, 2); // Remove 'remotes' e o nome do remote
               cleanName = parts.join('/');
             }

             this.allBranches.add(cleanName);

             // Prioriza guardar a referência remota (ex: remotes/origin/main)
             // Assim, se o usuário escolher 'main', usaremos a versão da nuvem e não a local desatualizada
             if (!this.branchBaseMapping.has(cleanName) || original.startsWith('remotes/')) {
                 this.branchBaseMapping.set(cleanName, original);
             }
        });

        const all = Array.from(this.allBranches);

        // Atualiza a lista do dropdown com as branches
        this.dropdownValues = all;
        this.filteredDropdownValues = [...all];
      } else {
        error(`Erro ao listar branches: ${allBranchesOutput.stderr}`);
        alert("Erro ao listar as branches do repositório Git.");
      }

    } catch (err) {
      error(`Erro ao executar comandos git: ${err}`);
      alert("Ocorreu um erro ao tentar executar o Git. A pasta selecionada é um repositório?");
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
      const localBranchesCmd = Command.create('git', ['branch'], { cwd: this.selectedFolder });
      const output = await localBranchesCmd.execute();

      if (output.code === 0) {
        const branches = output.stdout
          .split('\n')
          // Filtra linhas em branco
          .filter(b => b.trim().length > 0)
          // Filtra a branch atual que começa com asterisco '*' (eq. grep -v '^*')
          .filter(b => !b.trim().startsWith('*'))
          .map(b => ({
            name: b.trim(),
            selected: false
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
      .filter(b => b.selected)
      .map(b => b.name);

    if (branchesToDelete.length === 0) {
      alert("Selecione pelo menos uma branch para apagar.");
      return;
    }

    // Confirmação para evitar desastres
    if (!confirm(`Tem certeza que deseja apagar ${branchesToDelete.length} branch(es) local(is)?`)) {
      return;
    }

    this.isDeletingBranches = true;

    try {
      // Executa git branch -D branch1 branch2 ...
      const deleteCmd = Command.create('git', ['branch', '-D', ...branchesToDelete], { cwd: this.selectedFolder });
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

  // Autocomplete methods
  filterBranches() {
    this.showDropdown = true;
    const search = this.selectedDropdownValue.toLowerCase();
    this.filteredDropdownValues = this.dropdownValues.filter(b => b.toLowerCase().includes(search));
  }

  selectBranch(branch: string) {
    this.selectedDropdownValue = branch;
    this.showDropdown = false;
    this.filterBranches(); // Re-sync filter
  }

  hideDropdownDelayed() {
    // Timeout para permitir que o clique no item da lista seja registrado antes de esconder
    setTimeout(() => {
      this.showDropdown = false;
    }, 200);
  }

  get isBranchPaiValid(): boolean {
    if (!this.selectedDropdownValue) return false;
    // O valor deve ser exatamente uma das branches disponíveis
    return this.dropdownValues.includes(this.selectedDropdownValue);
  }

  // Gera o nome da branch formatado com base na regra Python
  get formattedBranchName(): string {
    if (!this.nomeBranch) return "";

    let name = this.nomeBranch;

    // remover caracteres especiais
    const charsToRemove = "!@#$%^&*()[]{};:,./<>?\\|`~-=_+";
    name = name.split('').filter(c => !charsToRemove.includes(c)).join('');

    // remover mais alguns
    name = name.replace(/[àâáãÀÂÁÃ]/g, 'a');
    name = name.replace(/[éêẽèÉÊẼÈ]/g, 'e');
    name = name.replace(/[íîĩÍÎĨ]/g, 'i');
    name = name.replace(/[óõôÓÕÔ]/g, 'o');
    name = name.replace(/[úûũÚÛŨ]/g, 'u');
    name = name.replace(/[çÇ]/g, 'c');

    // Substitui espaços por hífen, pois branch no git não pode ter espaço
    name = name.trim().replace(/\s+/g, "-");

    return `${this.branchType}/${name}`;
  }

  // Verifica se o nome da branch já existe
  get isBranchNameTaken(): boolean {
    if (!this.nomeBranch || !this.formattedBranchName) return false;
    return this.allBranches.has(this.formattedBranchName);
  }

  async onSubmit() {
    if (!this.selectedFolder || !this.selectedDropdownValue || !this.nomeBranch || !this.branchType) {
       alert("Por favor, preencha todos os campos antes de continuar.");
       return;
    }

    if (!this.isBranchPaiValid) {
       alert("A Branch Pai selecionada não é válida. Por favor, selecione uma da lista.");
       return;
    }

    if (this.isBranchNameTaken) {
        alert("Este nome de branch já está em uso!");
        return;
    }

    const branchName = this.formattedBranchName;

    // Pega a referência real da branch pai (se for remota, usa a versão do remote)
    const baseBranchForCheckout = this.branchBaseMapping.get(this.selectedDropdownValue) || this.selectedDropdownValue;

    info(`Tentando criar branch: ${branchName} a partir de ${baseBranchForCheckout}`);

    try {
      // Cria a nova branch a partir da branch pai selecionada
      // git checkout -b <nome-da-branch> <branch-pai>
      const createBranchCmd = Command.create('git', ['checkout', '-b', branchName, baseBranchForCheckout], { cwd: this.selectedFolder });
      const output = await createBranchCmd.execute();

      if (output.code === 0) {
        info(`Branch '${branchName}' criada com sucesso a partir de '${baseBranchForCheckout}'`);

        let copied = false;
        try {
          // Copia para o clipboard (agora usando o plugin oficial tauri-plugin-clipboard-manager)
          await writeText(branchName);
          copied = true;
        } catch (clipboardErr) {
          error(`Aviso: não foi possível copiar para o clipboard: ${clipboardErr}`);
        }

        if (copied) {
           alert(`Branch '${branchName}' criada! Já troquei de branch para você (e tá no clipboard tbm)!`);
        } else {
           alert(`Branch '${branchName}' criada! Já troquei de branch para você!`);
        }

        // Limpa o formulário e atualiza o estado
        this.nomeBranch = "";
        await this.loadRemoteBranches(this.selectedFolder);
      } else {
        error(`Erro ao criar branch: ${output.stderr}`);
        alert(`Erro ao criar branch:\n${output.stderr}`);
      }
    } catch (err) {
      error(`Erro ao executar comando git checkout: ${err}`);
      alert("Ocorreu um erro ao tentar criar a branch.");
    }
  }
}
