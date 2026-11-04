// ==UserScript==
// @name         Salesforce – Classificar atendimento GD4
// @namespace    sf-classificar-gd4
// @version      2.5
// @updateURL    https://raw.githubusercontent.com/DiegoSilva77/automacoes-atc/main/salesforce-classificar.user.js
// @downloadURL  https://raw.githubusercontent.com/DiegoSilva77/automacoes-atc/main/salesforce-classificar.user.js
// @description  Menu que preenche os campos do Formulário do caso no Salesforce com combinações prontas.
// @match        https://ambartech.lightning.force.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//
// Também funciona colando este arquivo inteiro no Console do navegador (F12 > Console)
// com um caso aberto: o botão ⚡ aparece no canto inferior direito.

(function () {
  'use strict';

  // ===================== CONFIGURAÇÃO =====================
  // Analista - N1: na primeira vez, o script pergunta quem é você (com os nomes da própria lista)
  // e guarda neste computador. Para trocar depois: menu ⚡ > "Trocar meu nome".
  const ANALISTA_LOGADO = { automatico: 'meuNome' };
  const SALVAR_AUTOMATICAMENTE = false;   // true = clica em "Salvar" no final
  const PAUSA_ENTRE_CAMPOS = 80;          // milissegundos; se algum campo falhar de vez em quando, aumente para 200

  // Atalho de teclado: seleciona a etapa "Resolvido" no caminho do caso e clica em "Marcar como Status atual".
  // Para trocar a tecla, mude "tecla" (ex.: 'KeyQ' para Q) e as teclas modificadoras (alt/ctrl/shift).
  const ATALHO_RESOLVIDO = { alt: true, ctrl: false, shift: false, tecla: 'KeyR', rotulo: 'Alt+R' };
  const ETAPA_RESOLVIDO = 'Resolvido';

  // Origem automática: lê "Nome da razão social" (cartão Detalhes de Contato).
  // Se for a conta abaixo → Fornecedores; qualquer outra coisa (ou vazio) → Construtores.
  // A conta é reconhecida pelo nome OU pelo código que aparece no link dela (o código continua valendo se o nome mudar).
  const CONTA_FORNECEDOR = { nome: 'FORNECEDOR/PROJETISTA AUTODOC', codigo: '001bJ00000Utpf3' };
  const ORIGEM_AUTOMATICA = { automatico: 'origemPelaRazaoSocial' };

  // Cada item vira uma opção do menu ⚡. Para criar um caso novo, copie um bloco { ... } inteiro e troque os valores.
  // Nome do campo e opção: exatamente como aparecem na tela (acentos e maiúsculas não importam).
  // A ORDEM IMPORTA: listas que dependem de outras (ex.: Subcategoria) ficam depois delas.
  // Para preencher um campo SÓ quando ele estiver vazio (e manter o que já tiver), use:
  //   'Nome do campo': { valor: 'Opção', soSeVazio: true },
  // Para a Origem decidir sozinha entre Fornecedores e Construtores, use:
  //   'Origem - GD4': ORIGEM_AUTOMATICA,
  // Para um campo que só existe em alguns formulários (ex.: CATRACA), use opcional: se não existir, é pulado:
  //   'Nome do campo': { valor: 'Opção', opcional: true },
  const CASOS = [
    {
      nome: 'Backup – Restauração',
      campos: {
        'Canal - Atendimento': { valor: 'Chat', soSeVazio: true }, // mantém Chat/Whatsapp se já vier preenchido
        'Módulo - GD4': 'Backup',
        'Origem - GD4': ORIGEM_AUTOMATICA, // Fornecedores ou Construtores, pela razão social
        'Categoria': 'Configuração',
        'Subcategoria - GD4': 'Restauração',
        'Analista - N1': ANALISTA_LOGADO,
        'Obra Associada': 'NÃO SE APLICA',
      },
    },
    {
      nome: 'Alteração de e-mail – Fornecedor',
      campos: {
        'Canal - Atendimento': { valor: 'Whatsapp', soSeVazio: true }, // mantém o que já vier preenchido
        'Módulo - GD4': 'Administrativo',
        'Origem - GD4': ORIGEM_AUTOMATICA, // Fornecedores ou Construtores, pela razão social
        'Categoria': 'Configuração',
        'Subcategoria - GD4': 'Alteração de E-mail Fornecedor',
        'Analista - N1': ANALISTA_LOGADO,
        'Obra Associada': 'NÃO SE APLICA',
      },
    },
    {
      nome: 'Abandono',
      campos: {
        'Canal - Atendimento': { valor: 'Whatsapp', soSeVazio: true }, // mantém o que já vier preenchido
        'Módulo - GD4': 'Abandono',
        'Origem - GD4': ORIGEM_AUTOMATICA, // Fornecedores ou Construtores, pela razão social
        'Categoria': 'Abandono',
        'Subcategoria - GD4': 'Abandono',
        'Subcategoria - CATRACA': { valor: 'Abandono', opcional: true }, // só existe em formulários da CATRACA
        'Analista - N1': ANALISTA_LOGADO,
        'Obra Associada': 'Abandono',
      },
    },
    {
      nome: 'Giro Invertido',
      campos: {
        'Canal - Atendimento': { valor: 'Whatsapp', soSeVazio: true }, // mantém o que já vier preenchido
        'Categoria': 'Configuração',
        'Subcategoria - CATRACA': 'Giro Invertido',
        'Analista - N1': ANALISTA_LOGADO,
      },
    },
  ];
  // ========================================================

  const norm = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\u2026]/g, '...')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const visivel = (el) => !!el && el.isConnected && el.getClientRects().length > 0;

  async function esperar(fn, timeout = 4000, intervalo = 30) {
    const fim = Date.now() + timeout;
    let ultimoErro = null;
    for (;;) {
      let r = null;
      try { r = fn(); } catch (e) { ultimoErro = e; } // o Salesforce às vezes bloqueia um comando; tenta de novo
      if (r) return r;
      if (Date.now() > fim && ultimoErro) console.warn('[SF classificar]', ultimoErro);
      if (Date.now() > fim) return null;
      await sleep(intervalo);
    }
  }

  // O Salesforce esconde os campos dentro de "shadow DOM"; esta busca entra em todos eles.
  function deepAll(seletor, raiz = document) {
    const achados = [];
    const pilha = [raiz];
    while (pilha.length) {
      const r = pilha.pop();
      r.querySelectorAll(seletor).forEach((e) => achados.push(e));
      r.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) pilha.push(e.shadowRoot); });
    }
    return achados;
  }

  function textoProfundo(no) {
    const partes = [];
    const visitar = (n) => {
      if (n.nodeType === 3) { partes.push(n.nodeValue); return; }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      if (n.shadowRoot) n.shadowRoot.childNodes.forEach(visitar);
      // <slot>: o conteúdo "encaixado" fica fora do bloco; segue até ele
      const enc = n.tagName === 'SLOT' && n.assignedNodes ? n.assignedNodes({ flatten: true }) : [];
      (enc.length ? enc : n.childNodes).forEach(visitar);
    };
    visitar(no);
    return partes.join(' ').replace(/\s+/g, ' ').trim();
  }

  function titulos(el) {
    const lista = [el.getAttribute('title')];
    deepAll('[title]', el.shadowRoot || el).forEach((t) => lista.push(t.getAttribute('title')));
    return lista.filter(Boolean).map(norm);
  }

  function clicar(el) {
    for (const tipo of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      const Ev = tipo.startsWith('pointer') && window.PointerEvent ? window.PointerEvent : MouseEvent;
      el.dispatchEvent(new Ev(tipo, { bubbles: true, composed: true, cancelable: true, view: window }));
    }
  }

  function digitar(input, valor) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, valor);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: valor, inputType: 'insertText' }));
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, composed: true, key: valor.slice(-1) || 'a' }));
  }

  // ---------- Localizar campos ----------
  const SELETOR_COMBOS = 'button[role="combobox"], input[role="combobox"]';
  const camposCombobox = () => deepAll(SELETOR_COMBOS);
  // Campo "Nome da razão social" pelo código interno (Contact.AccountId) — visto no F12 do Salesforce.
  const SELETOR_RAZAO_SOCIAL = '[data-target-selection-name$="Contact.AccountId"], records-record-layout-item[field-label="Nome da razão social"]';
  let cacheRazaoSocial = [];

  function buscarCampo(rotulo, soVisivel) {
    const alvo = norm(rotulo);
    const todos = camposCombobox().filter((e) => norm(e.getAttribute('aria-label')) === alvo);
    // o console pode ter vários casos abertos em abas escondidas: prefere o que está na tela
    return todos.find(visivel) || (soVisivel ? null : todos.find((e) => visivel(e.getRootNode().host || e)) || null);
  }

  // Varrer a página do Salesforce inteira é lento, então cada campo é localizado uma vez
  // e guardado; só procura de novo se o Salesforce trocar o campo de lugar.
  const cacheCampos = new Map();
  function acharCampo(rotulo, { soVisivel = true } = {}) {
    const chave = norm(rotulo);
    const c = cacheCampos.get(chave);
    if (c && c.isConnected && (!soVisivel || visivel(c))) return c;
    const novo = buscarCampo(rotulo, soVisivel);
    if (novo) cacheCampos.set(chave, novo);
    return novo;
  }

  // Uma única varredura da página acha os campos de lista/busca E o campo da razão social.
  function carregarCampos(rotulos) {
    cacheCampos.clear();
    const alvos = new Set(rotulos.map(norm));
    const encontrados = deepAll(SELETOR_COMBOS + ', ' + SELETOR_RAZAO_SOCIAL);
    cacheRazaoSocial = encontrados.filter((e) => e.matches(SELETOR_RAZAO_SOCIAL));
    const todos = encontrados.filter((e) => e.matches(SELETOR_COMBOS) && alvos.has(norm(e.getAttribute('aria-label'))));
    for (const e of todos.filter(visivel).concat(todos)) {
      const chave = norm(e.getAttribute('aria-label'));
      if (!cacheCampos.has(chave)) cacheCampos.set(chave, e);
    }
  }

  // A lista aberta fica no mesmo "shadow" do campo. O Salesforce bloqueia getElementById ali,
  // então a busca é feita só com querySelectorAll (que ele permite).
  function dropdownDe(campo) {
    const raiz = campo.getRootNode();
    const id = campo.getAttribute('aria-controls');
    if (id) {
      try {
        const drop = [...raiz.querySelectorAll('[id]')].find((e) => e.getAttribute('id') === id);
        if (drop) return drop;
      } catch (e) { /* segue com a raiz inteira */ }
    }
    return raiz;
  }

  function acharOpcao(campo, valor, modoBusca) {
    const alvo = norm(valor);
    const opcoes = deepAll('[role="option"]', dropdownDe(campo));
    if (!modoBusca) {
      return opcoes.find((o) =>
        titulos(o).includes(alvo) || norm(o.getAttribute('data-value')) === alvo || norm(textoProfundo(o)) === alvo
      ) || null;
    }
    // Nota de cada resultado: 3 = nome exato (título), 2 = texto exato,
    // 1 = começa com o nome seguido da construtora (2ª linha do resultado), 0 = não serve.
    const nota = (o) => {
      const t = norm(textoProfundo(o));
      if (/MOSTRAR TODOS|RESULTADOS PARA|^CRIAR |NOVO /.test(t)) return 0;
      if (titulos(o).includes(alvo)) return 3;
      if (t === alvo) return 2;
      if (t.startsWith(alvo + ' ') && !/^[-–:/(]/.test(t.slice(alvo.length + 1))) return 1;
      return 0;
    };
    const ehRegistro = (o) => /^[a-zA-Z0-9]{15,18}$/.test(o.getAttribute('data-value') || '');
    let melhor = null;
    let melhorNota = 0;
    for (const o of opcoes) {
      const n = nota(o) + (ehRegistro(o) ? 0.5 : 0);
      if (n >= 1 && n > melhorNota) { melhor = o; melhorNota = n; }
    }
    return melhor;
  }

  // ---------- Modo de edição ----------
  async function entrarEmEdicao(rotulos) {
    const alvos = rotulos.map(norm);
    const emEdicao = () => camposCombobox().some((e) => visivel(e) && alvos.includes(norm(e.getAttribute('aria-label'))));
    if (emEdicao()) return true;

    const lapis = deepAll('button').filter(visivel).find((b) => {
      const t = norm(b.getAttribute('title') || b.getAttribute('aria-label') || textoProfundo(b));
      return t.startsWith('EDITAR ') && alvos.includes(t.slice(7));
    });
    if (!lapis) return false;
    lapis.click();
    return !!(await esperar(emEdicao, 6000, 100));
  }

  // ---------- Campo de lista ----------
  const valorAtual = (campo) => [campo.getAttribute('data-value'), campo.textContent].map(norm);

  // Texto que está escolhido no campo de lista ('' se estiver vazio ou em "--Nenhum--").
  function textoLista(campo) {
    const t = norm(campo.getAttribute('data-value')) || norm(campo.textContent);
    return /^-*\s*NENHUM\s*-*$/.test(t) ? '' : t;
  }

  async function preencherLista(rotulo, valor) {
    const r = await tentarLista(rotulo, valor);
    if (r === 'preenchido' || r === 'já estava') return r;
    // Rede de segurança: se o modo rápido falhou, tenta de novo com calma.
    await sleep(400);
    const lista = dropdownAberto(acharCampo(rotulo));
    if (lista) acharCampo(rotulo).click(); // fecha a lista que ficou aberta
    await sleep(200);
    return tentarLista(rotulo, valor);
  }

  function dropdownAberto(campo) {
    return campo && campo.getAttribute('aria-expanded') === 'true';
  }

  async function tentarLista(rotulo, valor) {
    let campo = acharCampo(rotulo);
    if (!campo) return 'CAMPO NÃO ENCONTRADO';
    if (valorAtual(campo).includes(norm(valor))) return 'já estava';

    campo.click();
    const opcao = await esperar(() => acharOpcao(campo, valor, false), 3000);
    if (!opcao) {
      campo.click(); // fecha a lista
      return 'OPÇÃO NÃO ENCONTRADA';
    }
    if (opcao.scrollIntoView) opcao.scrollIntoView({ block: 'nearest' });
    clicar(opcao);

    const ok = () => { const c = acharCampo(rotulo); return c && valorAtual(c).includes(norm(valor)); };
    if (await esperar(ok, 1500)) return 'preenchido';
    opcao.click();
    return (await esperar(ok, 1500)) ? 'preenchido' : 'FALHOU';
  }

  // ---------- Campo de busca (lookup) ----------
  function botaoLimpar(raiz) {
    return deepAll('button', raiz).filter(visivel).find((b) =>
      /LIMPAR|REMOVER|CLEAR|REMOVE/.test(norm([b.getAttribute('title'), b.getAttribute('aria-label'), textoProfundo(b)].join(' ')))
    ) || null;
  }

  // Texto do registro escolhido no campo de busca (o próprio campo ou a "etiqueta" ao lado dele).
  function selecionado(campo) {
    if (norm(campo.value)) return norm(campo.value);
    const pill = deepAll('[class*="pill"] [title], [class*="pill__label"], .slds-pill', campo.getRootNode())
      .map((e) => norm(e.getAttribute('title') || textoProfundo(e))).find(Boolean);
    return pill || '';
  }

  async function preencherBusca(rotulo, valor) {
    const alvo = norm(valor);
    let campo = acharCampo(rotulo, { soVisivel: false });
    const raiz = campo.getRootNode();
    const editavel = (c) => c && visivel(c) && !c.readOnly && !norm(c.value);

    // Já tem algo selecionado?
    if (!editavel(campo)) {
      if (selecionado(campo) === alvo) return 'já estava';
      const limpar = botaoLimpar(raiz);
      if (!limpar) return 'NÃO CONSEGUI LIMPAR O VALOR ATUAL';
      limpar.click();
      campo = await esperar(() => { const c = acharCampo(rotulo); return editavel(c) ? c : null; }, 3000);
      if (!campo) return 'NÃO CONSEGUI LIMPAR O VALOR ATUAL';
    }

    campo.focus();
    campo.click();
    digitar(campo, valor);
    let opcao = await esperar(() => acharOpcao(campo, valor, true), 2500, 50);
    if (!opcao) {
      // Segunda tentativa: digita letra por letra, como uma pessoa.
      digitar(campo, '');
      for (let i = 1; i <= valor.length; i++) { digitar(campo, valor.slice(0, i)); await sleep(40); }
      opcao = await esperar(() => acharOpcao(campo, valor, true), 5000);
    }
    if (!opcao) return 'RESULTADO NÃO ENCONTRADO NA BUSCA';
    clicar(opcao);

    const ok = () => {
      const c = acharCampo(rotulo, { soVisivel: false });
      return c && selecionado(c) === alvo;
    };
    if (await esperar(ok, 2000)) return 'preenchido';
    opcao.click();
    return (await esperar(ok, 2000)) ? 'preenchido' : 'FALHOU';
  }

  // ---------- Razão social do contato ----------
  const subir = (e) => e.parentElement || (e.parentNode && e.parentNode.host) || null;

  // Como deepAll, mas a partir de um elemento: inclui ele mesmo, o shadow dele e o conteúdo encaixado nos <slot>.
  function deepAllIncluindo(el, seletor, vistos = new Set()) {
    if (vistos.has(el)) return [];
    vistos.add(el);
    const raizes = [el, el.shadowRoot].filter(Boolean);
    let achados = el.matches && el.matches(seletor) ? [el] : [];
    for (const r of raizes) {
      achados = achados.concat(deepAll(seletor, r));
      for (const slot of deepAll('slot', r)) {
        const enc = slot.assignedElements ? slot.assignedElements({ flatten: true }) : [];
        for (const e of enc) achados = achados.concat(deepAllIncluindo(e, seletor, vistos));
      }
    }
    return [...new Set(achados)];
  }

  // Acha o bloco do campo (no Salesforce, o elemento com a classe "slds-form-element") a partir do rótulo.
  function blocoDoRotulo(rotulo, alvo) {
    let el = rotulo;
    for (let i = 0; i < 10 && el; i++, el = subir(el)) {
      if (el.classList && el.classList.contains('slds-form-element')) return el;
    }
    // plano B: o menor bloco ao redor do rótulo que tenha algo além do próprio rótulo
    el = subir(rotulo);
    for (let i = 0; i < 4 && el; i++, el = subir(el)) {
      const resto = norm(textoProfundo(el)).replace(alvo, '').replace(/EDITAR/g, '').trim();
      if (resto && resto.length < 150) return el;
    }
    return null;
  }

  const limparRotulo = (t) => (t || '').replace(/Editar/gi, '').replace(/Nome da razão social/gi, '').replace(/\s+/g, ' ').trim();

  // Lê o valor de um bloco: { texto, codigo }.
  function lerBloco(bloco) {
    const elementos = deepAllIncluindo(bloco, 'a, [href], [data-recordid], [record-id], [data-record-id], [title]');
    // 1) código da conta em qualquer atributo (href, data-recordid, record-id…)
    let codigo = '';
    for (const e of elementos) {
      for (const at of e.attributes || []) {
        const m = (at.value || '').match(/\b(001[a-zA-Z0-9]{12,15})\b/);
        if (m) { codigo = m[1]; break; }
      }
      if (codigo) break;
    }
    // 2) texto do link, se houver
    const link = elementos.find((e) => e.tagName === 'A' && limparRotulo(textoProfundo(e)));
    let texto = link ? limparRotulo(textoProfundo(link)) : '';
    // 3) senão, o texto do bloco por dois caminhos diferentes
    if (!texto) texto = limparRotulo(textoProfundo(bloco));
    if (!texto) { try { texto = limparRotulo(bloco.innerText); } catch (e) { /* ignora */ } }
    return { texto, codigo };
  }

  const semEspacos = (t) => norm(t).replace(/\s+/g, '');
  function ehContaFornecedor(l) {
    return (!!l.codigo && l.codigo.slice(0, 15) === CONTA_FORNECEDOR.codigo.slice(0, 15)) ||
      (!!l.texto && semEspacos(l.texto).includes(semEspacos(CONTA_FORNECEDOR.nome)));
  }

  // A página pode ter mais de um campo "Nome da razão social" (ex.: um vazio no formulário do caso
  // e o preenchido no cartão Detalhes de Contato). Lê todos e usa o que tem valor.
  function lerRazaoSocial() {
    const alvo = norm('Nome da razão social');
    const lerTodos = (blocos) => [...new Set(blocos)].map((b) => ({ ...lerBloco(b), bloco: b }));
    const temValor = (ls) => ls.some((l) => l.texto || l.codigo);

    // Caminho rápido: o campo já localizado pelo código interno, na varredura do início.
    let leituras = lerTodos(cacheRazaoSocial.filter((e) => e.isConnected && visivel(e)));

    // Plano B (mais lento): procura pelo texto do rótulo. Só textos curtos são comparados,
    // para não reler o texto da página inteira a cada bloco.
    if (!temValor(leituras)) {
      let rotulos = deepAll('span, label, dt').filter((e) => {
        const t = e.textContent;
        return t && t.length <= 40 && norm(t) === alvo && visivel(e);
      });
      rotulos = rotulos.filter((r) => !rotulos.some((o) => o !== r && r.contains(o))); // só os mais internos
      leituras = lerTodos(leituras.map((l) => l.bloco).concat(rotulos.map((r) => blocoDoRotulo(r, alvo)).filter(Boolean)));
    }
    console.log('[SF classificar] "Nome da razão social" encontrados na tela:', leituras);
    if (!leituras.length) return { encontrado: false, texto: '', codigo: '' };
    const escolhida = leituras.find(ehContaFornecedor) || leituras.find((l) => l.texto) || leituras[0];
    return { encontrado: true, texto: escolhida.texto, codigo: escolhida.codigo };
  }

  function origemPelaRazaoSocial() {
    const rs = lerRazaoSocial();
    const ehFornecedor = ehContaFornecedor(rs);
    const valor = ehFornecedor ? 'Fornecedores' : 'Construtores';
    if (!rs.encontrado) {
      return { valor, aviso: 'CONFIRA: não achei "Nome da razão social" na tela, usei Construtores' };
    }
    return { valor, nota: `razão social: ${rs.texto || 'vazia'}` };
  }

  // ---------- Nome do analista (guardado neste computador) ----------
  const CHAVE_NOME = 'sfClassificar.meuNome';
  const lerNomeSalvo = () => { try { return localStorage.getItem(CHAVE_NOME) || ''; } catch (e) { return ''; } };
  const salvarNome = (n) => { try { n ? localStorage.setItem(CHAVE_NOME, n) : localStorage.removeItem(CHAVE_NOME); } catch (e) { /* sem acesso: pergunta de novo da próxima vez */ } };

  // Lê os nomes que aparecem na lista Analista - N1 (abre e fecha a lista).
  async function nomesDaLista(rotulo) {
    const campo = acharCampo(rotulo);
    if (!campo) return [];
    campo.click();
    const opcoes = await esperar(() => {
      const os = deepAll('[role="option"]', dropdownDe(campo));
      return os.length > 1 ? os : null;
    }, 3000);
    const nomes = (opcoes || [])
      .map((o) => {
        // o nome exibido: atributo title da opção (sem textos de acessibilidade), depois o valor, depois o texto
        const comTitulo = [o].concat(deepAll('[title]', o.shadowRoot || o)).find((e) => e.getAttribute && e.getAttribute('title'));
        return ((comTitulo && comTitulo.getAttribute('title')) || o.getAttribute('data-value') || textoProfundo(o) || '').trim();
      })
      .filter((n) => n && !/NENHUM/.test(norm(n)));
    if (campo.getAttribute('aria-expanded') === 'true') campo.click(); // fecha a lista
    return [...new Set(nomes)];
  }

  // Palpite do nome pelo e-mail de quem está logado (ex.: maria.souza@… → "Maria … Souza").
  function palpiteDeNome(nomes) {
    let email = '';
    try { email = (window.$A && window.$A.get('$SObjectType.CurrentUser.Email')) || ''; } catch (e) { /* sem palpite */ }
    const partes = norm(email.split('@')[0]).split(/[._-]+/).filter((p) => p.length > 1);
    if (!partes.length) return '';
    const candidatos = nomes.filter((n) => partes.every((p) => norm(n).split(' ').includes(p)));
    return candidatos.length === 1 ? candidatos[0] : '';
  }

  // Janela "Quem é você?" — devolve o nome escolhido, ou '' se a pessoa cancelar.
  function perguntarNome(nomes, palpite) {
    return new Promise((resolver) => {
      const fundo = document.createElement('div');
      fundo.id = 'sf-auto-nome';
      Object.assign(fundo.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,.35)', zIndex: 2147483647,
        display: 'flex', alignItems: 'center', justifyContent: 'center', font: '14px/1.4 system-ui, sans-serif',
      });
      const caixa = document.createElement('div');
      Object.assign(caixa.style, {
        background: '#fff', borderRadius: '10px', padding: '20px 22px', width: 'min(380px, calc(100vw - 32px))',
        boxShadow: '0 10px 40px rgba(0,0,0,.3)', color: '#181818',
      });
      const titulo = document.createElement('div');
      titulo.textContent = 'Quem é você na lista "Analista - N1"?';
      Object.assign(titulo.style, { fontWeight: '700', fontSize: '15px', marginBottom: '6px' });
      const texto = document.createElement('div');
      texto.textContent = 'Escolha uma vez: fica salvo neste computador e as automações passam a usar o seu nome.';
      Object.assign(texto.style, { color: '#555', fontSize: '13px', marginBottom: '14px' });
      const sel = document.createElement('select');
      Object.assign(sel.style, { width: '100%', padding: '8px', fontSize: '14px', borderRadius: '6px', border: '1px solid #c9c9c9' });
      const vazio = document.createElement('option');
      vazio.value = '';
      vazio.textContent = '— escolha seu nome —';
      sel.appendChild(vazio);
      for (const n of nomes) {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = n;
        if (n === palpite) o.selected = true;
        sel.appendChild(o);
      }
      const botoes = document.createElement('div');
      Object.assign(botoes.style, { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' });
      const mkBotao = (rotulo, primario) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = rotulo;
        Object.assign(b.style, {
          padding: '8px 14px', borderRadius: '6px', cursor: 'pointer', font: '600 13px system-ui, sans-serif',
          border: primario ? 'none' : '1px solid #c9c9c9', background: primario ? AZUL : '#fff', color: primario ? '#fff' : '#181818',
        });
        return b;
      };
      const cancelar = mkBotao('Cancelar', false);
      const salvar = mkBotao('Salvar', true);
      const fechar = (valor) => { fundo.remove(); resolver(valor); };
      cancelar.addEventListener('click', () => fechar(''));
      salvar.addEventListener('click', () => {
        if (!sel.value) { sel.style.borderColor = '#c23934'; sel.focus(); return; }
        fechar(sel.value);
      });
      fundo.addEventListener('keydown', (e) => { if (e.key === 'Escape') fechar(''); if (e.key === 'Enter' && sel.value) fechar(sel.value); });
      botoes.append(cancelar, salvar);
      caixa.append(titulo, texto, sel, botoes);
      fundo.appendChild(caixa);
      document.body.appendChild(fundo);
      sel.focus();
    });
  }

  async function meuNome(rotulo) {
    const salvo = lerNomeSalvo();
    if (salvo) return { valor: salvo };
    const nomes = await nomesDaLista(rotulo);
    if (!nomes.length) return { valor: null, aviso: 'NÃO CONSEGUI LER OS NOMES DA LISTA' };
    const escolhido = await perguntarNome(nomes, palpiteDeNome(nomes));
    if (!escolhido) return { valor: null, aviso: 'PULADO: você não escolheu seu nome' };
    salvarNome(escolhido);
    return { valor: escolhido, nota: 'nome salvo neste computador' };
  }

  const AUTOMATICOS = { origemPelaRazaoSocial, meuNome };

  // ---------- Execução ----------
  const RESULTADOS_OK = ['preenchido', 'já estava', 'clicado', 'mantido', 'ignorado'];
  const ehProblema = (r) => !RESULTADOS_OK.includes(r.resultado);
  let rodando = false;

  async function executar(caso) {
    if (rodando) return;
    rodando = true;
    definirStatus(`⏳ ${caso.nome}…`);
    const relatorio = [];
    const inicio = Date.now();
    try {
      const rotulos = Object.keys(caso.campos);
      const editou = await entrarEmEdicao(rotulos);
      if (editou) carregarCampos(rotulos);
      if (!editou) {
        relatorio.push({ item: 'Edição', resultado: 'NÃO CONSEGUI ABRIR A EDIÇÃO. Clique no lápis de um campo e tente de novo' });
      } else {
        for (const [rotulo, config] of Object.entries(caso.campos)) {
          let valor = typeof config === 'object' ? config.valor : config;
          const soSeVazio = typeof config === 'object' && !!config.soSeVazio;
          const opcional = typeof config === 'object' && !!config.opcional;
          let extra = null;
          if (config && config.automatico) {
            extra = await AUTOMATICOS[config.automatico](rotulo);
            valor = extra.valor;
            if (valor === null) {
              relatorio.push({ item: rotulo, resultado: extra.aviso });
              continue;
            }
          }
          const campo = acharCampo(rotulo, { soVisivel: false });
          const ehLista = campo && campo.tagName === 'BUTTON';
          const atual = campo ? (ehLista ? textoLista(campo) : selecionado(campo)) : '';
          let resultado;
          if (!campo && opcional) {
            relatorio.push({ item: `${rotulo}: não existe neste formulário`, resultado: 'ignorado' });
            continue;
          }
          if (!campo) resultado = 'CAMPO NÃO ENCONTRADO';
          else if (soSeVazio && atual) resultado = 'mantido';
          else if (ehLista) resultado = await preencherLista(rotulo, valor);
          else resultado = await preencherBusca(rotulo, valor);
          if (resultado === 'mantido') {
            const texto = (ehLista ? campo.textContent : campo.value || '').trim() || atual;
            relatorio.push({ item: `${rotulo}: mantido "${texto}"`, resultado });
            continue;
          }
          if (extra && extra.aviso && (resultado === 'preenchido' || resultado === 'já estava')) resultado = extra.aviso;
          relatorio.push({ item: `${rotulo}: ${valor}${extra && extra.nota ? ` (${extra.nota})` : ''}`, resultado });
          // pausa curta só quando o campo mudou, para as listas dependentes (ex.: Subcategoria) atualizarem
          if (resultado === 'preenchido') await sleep(PAUSA_ENTRE_CAMPOS);
        }

        if (SALVAR_AUTOMATICAMENTE && !relatorio.some(ehProblema)) {
          const salvar = deepAll('button').filter(visivel)
            .find((b) => b.getAttribute('name') === 'SaveEdit' || norm(textoProfundo(b)) === 'SALVAR');
          if (salvar) { salvar.click(); relatorio.push({ item: 'Salvar', resultado: 'clicado' }); }
          else relatorio.push({ item: 'Salvar', resultado: 'BOTÃO SALVAR NÃO ENCONTRADO' });
        }
      }
    } catch (e) {
      console.error('[SF classificar]', e);
      relatorio.push({ item: 'Erro', resultado: String(e) });
    }
    const segundos = ((Date.now() - inicio) / 1000).toFixed(1).replace('.', ',');
    console.table(relatorio);
    mostrarResultado(caso, relatorio, segundos);
    definirStatus(null);
    rodando = false;
  }

  // ---------- Atalho: marcar como Resolvido ----------
  function acharEtapa(nome) {
    const alvo = norm(nome);
    return deepAll('a.slds-path__link, a[data-tab-name], li[data-name] a[role="option"]')
      .filter((a) => a.isConnected && visivel(a))
      .find((a) => [a.getAttribute('data-tab-name'), a.getAttribute('title'), a.closest('li') && a.closest('li').getAttribute('data-name')]
        .some((v) => norm(v) === alvo)) || null;
  }

  const etapaAtual = (a) => {
    const li = a && a.closest('li');
    return !!li && li.classList.contains('slds-is-current');
  };

  function botaoMarcarAtual() {
    return deepAll('button.slds-path__mark-complete, button.stepAction').filter(visivel)
      .find((b) => norm(textoProfundo(b)) === 'MARCAR COMO STATUS ATUAL') || null;
  }

  async function marcarResolvido() {
    if (rodando) return;
    rodando = true;
    definirStatus('⏳ Marcando como Resolvido…');
    try {
      // Formulário em edição sem salvar: mudar o status agora poderia perder o que foi preenchido.
      if (deepAll('button[name="SaveEdit"]').some(visivel)) {
        mostrarAviso('Salve (ou cancele) a edição do formulário antes de marcar como Resolvido.', true);
        return;
      }
      const etapa = acharEtapa(ETAPA_RESOLVIDO);
      if (!etapa) { mostrarAviso(`Não encontrei a etapa "${ETAPA_RESOLVIDO}" neste caso.`, true); return; }
      // Já resolvido: não clica em nada (o botão viraria "Marcar Status como concluído(a)" e iria para Fechado).
      if (etapaAtual(etapa)) { mostrarAviso(`Este caso já está como ${ETAPA_RESOLVIDO}.`, false); return; }

      etapa.click();
      const selecionada = () => { const e = acharEtapa(ETAPA_RESOLVIDO); return e && e.getAttribute('aria-selected') === 'true'; };
      const botao = await esperar(() => (selecionada() ? botaoMarcarAtual() : null), 4000, 50);
      if (!botao) { mostrarAviso('NÃO ENCONTREI o botão "Marcar como Status atual". Nada foi alterado.', true); return; }
      botao.click();

      const ok = await esperar(() => etapaAtual(acharEtapa(ETAPA_RESOLVIDO)), 8000, 150);
      if (ok) mostrarAviso(`Status alterado para ${ETAPA_RESOLVIDO}.`, false);
      else mostrarAviso('Cliquei em "Marcar como Status atual", mas não consegui confirmar a mudança.\n' +
        'Confira o status: o Salesforce pode ter aberto uma janela pedindo mais informações.', true);
    } catch (e) {
      console.error('[SF classificar]', e);
      mostrarAviso('Erro ao marcar como Resolvido: ' + e, true);
    } finally {
      definirStatus(null);
      rodando = false;
    }
  }

  document.addEventListener('keydown', (e) => {
    const a = ATALHO_RESOLVIDO;
    if (e.code !== a.tecla || e.altKey !== a.alt || e.ctrlKey !== a.ctrl || e.shiftKey !== a.shift || e.repeat) return;
    if (!/\/lightning\/r\//.test(location.pathname)) return;
    e.preventDefault();
    e.stopPropagation();
    marcarResolvido();
  }, true);

  // ---------- Interface ----------

  // Aviso no canto da tela. Fecha sozinho (6 s se deu certo, 20 s se teve problema),
  // ou na hora: botão ✕, tecla Esc ou clique no próprio aviso.
  function fecharAviso() {
    const box = document.getElementById('sf-auto-toast');
    if (box) { clearTimeout(box._t); box.remove(); }
  }

  function mostrarAviso(texto, problema) {
    fecharAviso();
    const box = document.createElement('div');
    box.id = 'sf-auto-toast';
    box.title = 'Clique para fechar';
    Object.assign(box.style, {
      position: 'fixed', right: '76px', bottom: '56px', zIndex: 2147483647, maxWidth: '440px',
      background: problema ? '#7a1f1f' : '#1f5f3a', color: '#fff', padding: '12px 38px 12px 14px',
      borderRadius: '8px', font: '13px/1.4 system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.3)',
      whiteSpace: 'pre-wrap', cursor: 'pointer',
    });
    const msg = document.createElement('div');
    msg.textContent = texto;
    const fechar = document.createElement('button');
    fechar.type = 'button';
    fechar.textContent = '✕';
    fechar.setAttribute('aria-label', 'Fechar aviso');
    Object.assign(fechar.style, {
      position: 'absolute', top: '6px', right: '6px', width: '26px', height: '26px', borderRadius: '50%',
      border: 'none', background: 'rgba(255,255,255,.18)', color: '#fff', font: '700 13px system-ui, sans-serif',
      cursor: 'pointer', lineHeight: '26px', padding: '0',
    });
    fechar.addEventListener('mouseenter', () => { fechar.style.background = 'rgba(255,255,255,.35)'; });
    fechar.addEventListener('mouseleave', () => { fechar.style.background = 'rgba(255,255,255,.18)'; });
    box.addEventListener('click', fecharAviso);
    box.append(msg, fechar);
    document.body.appendChild(box);
    box._t = setTimeout(fecharAviso, problema ? 20000 : 6000);
  }

  function mostrarResultado(caso, relatorio, segundos) {
    const problemas = relatorio.filter(ehProblema);
    mostrarAviso(problemas.length
      ? `${caso.nome}: ${problemas.length} item(ns) com problema:\n` +
        problemas.map((p) => `• ${p.item} → ${p.resultado}`).join('\n') + '\n\n(Detalhes no Console, F12)'
      : `${caso.nome}: tudo preenchido em ${segundos}s!\n` +
        relatorio.filter((r) => /\(razão social/.test(r.item)).map((r) => r.item + '\n').join('') +
        (SALVAR_AUTOMATICAMENTE ? 'Salvo.' : 'Confira e clique em Salvar.'),
    problemas.length > 0);
  }

  const AZUL = '#1a73e8';

  function definirStatus(texto) {
    const botao = document.getElementById('sf-auto-botao');
    if (!botao) return;
    botao.disabled = !!texto;
    botao.textContent = texto ? '⏳' : '⚡';
    botao.title = texto || 'Automações de classificação';
    botao.style.cursor = texto ? 'wait' : 'pointer';
    if (texto) abrirMenu(false);
  }

  function abrirMenu(abrir) {
    const menu = document.getElementById('sf-auto-menu');
    if (!menu) return;
    const aberto = abrir === undefined ? menu.style.display === 'none' : abrir;
    const trocar = document.getElementById('sf-auto-trocar-nome');
    if (trocar) {
      const nome = lerNomeSalvo();
      trocar.textContent = nome ? `⚙ Trocar meu nome (${nome})` : '⚙ Meu nome: será perguntado na próxima automação';
      const dica = document.getElementById('sf-auto-dica-atalho');
      if (dica) dica.textContent = `⌨ ${ATALHO_RESOLVIDO.rotulo}: marcar o caso como ${ETAPA_RESOLVIDO}`;
    }
    menu.style.display = aberto ? 'flex' : 'none';
    document.getElementById('sf-auto-botao').setAttribute('aria-expanded', String(aberto));
  }

  function criarPainel() {
    if (document.getElementById('sf-auto-ui')) return;
    const ui = document.createElement('div');
    ui.id = 'sf-auto-ui';
    Object.assign(ui.style, {
      position: 'fixed', right: '20px', bottom: '56px', zIndex: 2147483646,
      font: '13px/1.3 system-ui, sans-serif',
    });

    // Menu com as automações (abre acima do botão)
    const menu = document.createElement('div');
    menu.id = 'sf-auto-menu';
    menu.setAttribute('role', 'menu');
    Object.assign(menu.style, {
      display: 'none', flexDirection: 'column', position: 'absolute', right: '0', bottom: '52px',
      minWidth: '250px', background: '#fff', borderRadius: '8px', padding: '6px 0',
      boxShadow: '0 6px 24px rgba(0,0,0,.25)', border: '1px solid #dddbda',
    });
    const titulo = document.createElement('div');
    titulo.textContent = 'Classificar atendimento';
    Object.assign(titulo.style, {
      padding: '6px 14px 8px', color: '#706e6b', fontSize: '11px', fontWeight: '600',
      textTransform: 'uppercase', letterSpacing: '.04em', borderBottom: '1px solid #eee', marginBottom: '4px',
    });
    menu.appendChild(titulo);
    for (const caso of CASOS) {
      const item = document.createElement('button');
      item.type = 'button';
      item.setAttribute('role', 'menuitem');
      item.textContent = caso.nome;
      Object.assign(item.style, {
        background: 'none', border: 'none', textAlign: 'left', padding: '9px 14px', cursor: 'pointer',
        color: '#181818', font: 'inherit', whiteSpace: 'nowrap',
      });
      item.addEventListener('mouseenter', () => { item.style.background = '#f3f6fd'; });
      item.addEventListener('mouseleave', () => { item.style.background = 'none'; });
      item.addEventListener('click', () => { abrirMenu(false); executar(caso); });
      menu.appendChild(item);
    }

    // Rodapé: trocar o nome do analista guardado neste computador
    const trocar = document.createElement('button');
    trocar.type = 'button';
    trocar.id = 'sf-auto-trocar-nome';
    Object.assign(trocar.style, {
      background: 'none', border: 'none', borderTop: '1px solid #eee', marginTop: '4px', textAlign: 'left',
      padding: '8px 14px 4px', cursor: 'pointer', color: '#706e6b', font: '12px system-ui, sans-serif', whiteSpace: 'nowrap',
    });
    trocar.addEventListener('click', () => {
      abrirMenu(false);
      salvarNome('');
      mostrarAviso('Pronto! Na próxima automação vou perguntar o seu nome de novo.', false);
    });
    menu.appendChild(trocar);

    const dica = document.createElement('div');
    dica.id = 'sf-auto-dica-atalho';
    Object.assign(dica.style, { padding: '2px 14px 6px', color: '#706e6b', font: '12px system-ui, sans-serif', whiteSpace: 'nowrap' });
    menu.appendChild(dica);

    // Botão redondo que abre/fecha o menu
    const botao = document.createElement('button');
    botao.id = 'sf-auto-botao';
    botao.type = 'button';
    botao.textContent = '⚡';
    botao.title = 'Automações de classificação';
    botao.setAttribute('aria-haspopup', 'menu');
    botao.setAttribute('aria-expanded', 'false');
    Object.assign(botao.style, {
      width: '44px', height: '44px', borderRadius: '50%', border: 'none', background: AZUL, color: '#fff',
      fontSize: '20px', lineHeight: '44px', padding: '0', cursor: 'pointer',
      boxShadow: '0 2px 10px rgba(0,0,0,.3)',
    });
    botao.addEventListener('click', (e) => { e.stopPropagation(); abrirMenu(); });

    ui.appendChild(menu);
    ui.appendChild(botao);
    document.body.appendChild(ui);
  }

  // Fecha o menu ao clicar fora dele ou apertar Esc.
  document.addEventListener('click', (e) => {
    const ui = document.getElementById('sf-auto-ui');
    if (ui && !e.composedPath().includes(ui)) abrirMenu(false);
  }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { abrirMenu(false); fecharAviso(); } });

  // Mostra o botão só quando há um registro aberto (endereço com /lightning/r/).
  function verificarTela() {
    const naTela = /\/lightning\/r\//.test(location.pathname);
    const ui = document.getElementById('sf-auto-ui');
    if (naTela) criarPainel();
    else if (ui) ui.remove();
  }
  verificarTela();
  setInterval(verificarTela, 1500);

  window.sfClassificar = (nome) => executar(CASOS.find((c) => !nome || c.nome === nome)); // uso pelo Console
})();
