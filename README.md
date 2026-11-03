# automacoes-atc

Scripts para o Tampermonkey que automatizam tarefas repetitivas da equipe de suporte no **GD4** e no **Salesforce**.

| Script | Onde funciona | O que faz |
| --- | --- | --- |
| GD4 – Preencher cadastro de usuário | Tela de cadastro de usuário do GD4 | Preenche o Nome com a conta, gera um CPF válido, liga Administrador e as flags de e-mail |
| Salesforce – Classificar atendimento | Casos no Salesforce | Menu ⚡ que preenche o Formulário do caso com combinações prontas (Backup, Alteração de e-mail, Abandono) |

## Instalação

1. Instale a extensão **Tampermonkey** no Chrome ou no Edge.
2. Clique com o botão direito no ícone do Tampermonkey e escolha **Gerenciar extensão**. Ligue **Permitir scripts de usuário** (*Allow User Scripts*).
3. Clique nos links abaixo. O Tampermonkey abre uma tela de instalação: clique em **Instalar**.
   - [Instalar script do GD4](https://raw.githubusercontent.com/DiegoSilva77/automacoes-atc/main/gd4-cadastro-usuario.user.js)
   - [Instalar script do Salesforce](https://raw.githubusercontent.com/DiegoSilva77/automacoes-atc/main/salesforce-classificar.user.js)
4. Recarregue o GD4 e o Salesforce com **F5**.

As atualizações chegam sozinhas (o Tampermonkey verifica uma vez por dia). Para receber na hora: ícone do Tampermonkey > **Verificar atualizações de scripts de usuário**.

## Como usar

**GD4:** na tela de cadastro de usuário, clique no botão azul **⚡ Preencher padrão** no canto inferior direito. Confira a tela e clique em **Salvar**.

**Salesforce:** com um caso aberto, clique no botão redondo **⚡** e escolha a automação. Ela entra em edição, preenche os campos e mostra um aviso:

- 🟩 **Verde:** tudo preenchido. Confira e clique em **Salvar**.
- 🟥 **Vermelho:** algum campo não foi preenchido. O aviso diz qual.

Na primeira vez, o script pergunta **quem é você** na lista *Analista - N1*. O nome fica salvo no seu computador. Para trocar: menu ⚡ > **Trocar meu nome**.

Regras automáticas:
- **Canal - Atendimento:** se já estiver preenchido, é mantido.
- **Origem - GD4:** *Fornecedores* quando a razão social do contato é FORNECEDOR/PROJETISTA AUTODOC. Nos outros casos, *Construtores*.
- **Subcategoria - CATRACA:** preenchida só quando existe no formulário.

## Problemas comuns

| O que acontece | Como resolver |
| --- | --- |
| O botão ⚡ não aparece | Confira o passo 2 da instalação e recarregue a página com F5 |
| Aviso vermelho com "NÃO ENCONTRADA" | A tela pode ter mudado. Tire um print do aviso e envie para o responsável pelos scripts |
| A extensão é bloqueada no computador | Peça ao TI a liberação do Tampermonkey |


Mantido por Diego Araujo Silva.
