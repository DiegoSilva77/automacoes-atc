// ==UserScript==
// @name         GD4 – Preencher cadastro de usuário (padrão)
// @namespace    gd4-cadastro-usuario
// @version      1.1
// @updateURL    https://raw.githubusercontent.com/DiegoSilva77/automacoes-autodoc/main/salesforce-classificar.user.js
// @downloadURL  https://raw.githubusercontent.com/DiegoSilva77/automacoes-autodoc/main/salesforce-classificar.user.js
// @description  Adiciona um botão na tela de cadastro de usuário do GD4 que gera um CPF válido, liga "Administrador" e as flags de recebimento de e-mails.
// @match        https://*.autodoc.com.br/*
// @match        https://*.autodocdev.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
//
// Também funciona colando este arquivo inteiro no Console do navegador (F12 > Console)
// com a tela de cadastro aberta: o botão aparece no canto inferior direito.

(function () {
  'use strict';

  // ===================== CONFIGURAÇÃO =====================
  // Textos exatamente como aparecem na tela (acentos e maiúsculas não importam).
  const LIGAR_PERMISSOES = [
    'Administrador',
  ];

  const LIGAR_EMAILS = [
    'Receber alteras de solicitação de desvínculo de colaborador', // "alteras" está assim na tela mesmo
    'Receber alertas de cadastro de documentos',
    'Receber alertas de cadastro de certificações',
    'Receber alertas de exigência de documentos mensais',
    'Receber alertas de exigência de documentos de encerramento',
    'Receber alertas de documentos reprovados',
    'Receber alertas de vencimento de documentos',
    'Receber alertas de agendamento de treinamento',
    'Receber alertas de vencimento de treinamento',
    'Receber relatório gerencial de obra',
    'Receber relatório registro de acesso',
    'Receber alertas ao atingir número de advertências por colaborador',
    'Receber alertas para desbloqueio de colaboradores advertidos',
  ];

  const SOBRESCREVER_NOME = false; // true = troca o Nome mesmo se o campo já estiver preenchido
  const SOBRESCREVER_CPF = false; // true = troca o CPF mesmo se o campo já estiver preenchido
  const MARCADOR_TELA = 'Configurar recebimento de e-mails'; // o botão só aparece se este texto estiver na página
  // ========================================================

  const norm = (s) =>
    (s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---------- CPF ----------
  function gerarCPF() {
    const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
    if (n.every((d) => d === n[0])) return gerarCPF(); // 111.111.111-xx etc. são inválidos
    const dv = (arr) => {
      const pesoInicial = arr.length + 1;
      const soma = arr.reduce((acc, d, i) => acc + d * (pesoInicial - i), 0);
      const resto = soma % 11;
      return resto < 2 ? 0 : 11 - resto;
    };
    n.push(dv(n));
    n.push(dv(n));
    const s = n.join('');
    return `${s.slice(0, 3)}.${s.slice(3, 6)}.${s.slice(6, 9)}-${s.slice(9)}`;
  }

  function preencherInput(input, valor) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, valor);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (window.jQuery) window.jQuery(input).trigger('keyup').trigger('change');
    input.dispatchEvent(new Event('blur', { bubbles: true }));
    input.blur();
  }

  // ---------- Busca de elementos por texto ----------
  // Lista elementos com texto curto (rótulos) uma única vez, para não ficar lento.
  function indexarRotulos() {
    const lista = [];
    document.querySelectorAll('body *').forEach((el) => {
      if (['SCRIPT', 'STYLE', 'OPTION', 'SELECT', 'NOSCRIPT'].includes(el.tagName)) return;
      if (el.closest('#gd4-auto-ui')) return;
      const t = el.textContent;
      if (!t || t.length > 200) return;
      lista.push({ el, t: norm(t) });
    });
    return lista;
  }

  function candidatosPorTexto(indice, texto) {
    const alvo = norm(texto);
    const achados = indice.filter((x) => x.t === alvo).map((x) => x.el);
    // fica só com os mais internos (que não contêm outro candidato)
    return achados.filter((el) => !achados.some((o) => o !== el && el.contains(o)));
  }

  const SELETOR_SWITCH = '.bootstrap-switch, .switch, .toggle, .onoffswitch, [role="switch"]';

  // A partir do rótulo, sobe no HTML até achar o "container da linha" que tem exatamente 1 toggle.
  function acharToggle(rotulo) {
    if (rotulo.tagName === 'LABEL' && rotulo.htmlFor) {
      const alvo = document.getElementById(rotulo.htmlFor);
      if (alvo && alvo.type === 'checkbox') return { input: alvo, container: rotulo.parentElement };
    }
    let el = rotulo;
    for (let i = 0; i < 7 && el && el !== document.body; i++, el = el.parentElement) {
      const checks = el.querySelectorAll('input[type="checkbox"]');
      if (checks.length === 1) return { input: checks[0], container: el };
      if (checks.length > 1) return null; // subiu demais (pegou várias linhas)
      const sws = el.querySelectorAll(SELETOR_SWITCH);
      if (sws.length === 1) return { input: null, sw: sws[0], container: el };
      if (sws.length > 1) return null;
    }
    return null;
  }

  function estaLigado(t) {
    if (t.input) return t.input.checked;
    const aria = t.sw.getAttribute('aria-checked');
    if (aria != null) return aria === 'true';
    const cls = t.sw.className || '';
    return /(^|[\s-])(on|active|checked)(\s|$)/i.test(cls) && !/(^|[\s-])off(\s|$)/i.test(cls);
  }

  async function ligar(t) {
    if (estaLigado(t)) return 'já estava ligada';
    if (t.input) {
      t.input.click(); // dispara o evento que o componente visual (ex.: bootstrap-switch) escuta
      await sleep(80);
      if (!t.input.checked) {
        const visual = t.container.querySelector(SELETOR_SWITCH + ', label');
        if (visual) visual.click();
        await sleep(80);
      }
    } else {
      t.sw.click();
      await sleep(80);
    }
    return estaLigado(t) ? 'ligada' : 'FALHOU';
  }

  async function ligarLista(indice, textos, relatorio) {
    for (const texto of textos) {
      const cands = candidatosPorTexto(indice, texto);
      let feito = false;
      for (const c of cands) {
        const t = acharToggle(c);
        if (!t) continue;
        relatorio.push({ item: texto, resultado: await ligar(t) });
        feito = true;
        break;
      }
      if (!feito) relatorio.push({ item: texto, resultado: 'NÃO ENCONTRADA' });
    }
  }

  // ---------- Campos de texto (Nome, CPF) ----------
  const SELETOR_TEXTO = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio])';

  // Procura o campo pelo rótulo visível na tela; se não achar, tenta pelos atributos do input.
  function acharCampo(indice, regexRotulo, regexAtributo) {
    const rotulos = indice.filter((x) => regexRotulo.test(x.t)).map((x) => x.el);
    for (const r of rotulos) {
      if (r.tagName === 'LABEL' && r.htmlFor) {
        const alvo = document.getElementById(r.htmlFor);
        if (alvo) return alvo;
      }
      let el = r;
      for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
        const campos = el.querySelectorAll(SELETOR_TEXTO);
        if (campos.length === 1) return campos[0];
        if (campos.length > 1) break;
      }
    }
    const inputs = [...document.querySelectorAll(SELETOR_TEXTO)];
    return (
      inputs.find((i) =>
        [i.name, i.id, i.getAttribute('formcontrolname'), i.getAttribute('ng-model')].some((v) => v && regexAtributo.test(v))
      ) || null
    );
  }

  const acharCampoNome = (indice) => acharCampo(indice, /^NOME\s*\*?\s*:?$/, /^(nome|name|nomeusuario|usuario\.nome)$/i);

  // Lê o nome da empresa no topo da tela ("Conta: Mpd Engenharia" -> "Mpd Engenharia").
  function lerNomeConta() {
    let melhor = null;
    document.querySelectorAll('body *').forEach((el) => {
      if (['SCRIPT', 'STYLE', 'OPTION', 'SELECT'].includes(el.tagName) || el.closest('#gd4-auto-ui')) return;
      const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (t.length > 120) return;
      const m = t.match(/^Conta\s*:\s*(.+)$/i);
      if (!m) return;
      // fica com o elemento mais interno (texto mais curto); em empate, o primeiro da página (topo)
      if (!melhor || t.length < melhor.len) melhor = { len: t.length, nome: m[1].trim() };
    });
    return melhor ? melhor.nome : null;
  }

  function acharCampoCPF(indice) {
    const inputs = [...document.querySelectorAll(SELETOR_TEXTO)];
    const porAtributo = inputs.find((i) =>
      /cpf/i.test([i.name, i.id, i.placeholder, i.getAttribute('formcontrolname'), i.getAttribute('ng-model')].join(' '))
    );
    if (porAtributo) return porAtributo;

    const rotulos = indice.filter((x) => /^CPF\b/.test(x.t) && x.t.length <= 8).map((x) => x.el);
    for (const r of rotulos) {
      if (r.tagName === 'LABEL' && r.htmlFor) {
        const alvo = document.getElementById(r.htmlFor);
        if (alvo) return alvo;
      }
      let el = r;
      for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
        const campos = el.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio])');
        if (campos.length === 1) return campos[0];
        if (campos.length > 1) break;
      }
    }
    return null;
  }

  // ---------- Execução ----------
  async function executar() {
    const btn = document.getElementById('gd4-auto-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Preenchendo…'; }
    const relatorio = [];
    try {
      let indice = indexarRotulos();

      const nomeConta = lerNomeConta();
      const campoNome = acharCampoNome(indice);
      if (!nomeConta) {
        relatorio.push({ item: 'Nome', resultado: 'NOME DA CONTA NÃO ENCONTRADO no topo da tela' });
      } else if (!campoNome) {
        relatorio.push({ item: 'Nome', resultado: 'CAMPO NÃO ENCONTRADO' });
      } else if (campoNome.value.trim() && !SOBRESCREVER_NOME) {
        relatorio.push({ item: 'Nome', resultado: `mantido (${campoNome.value})` });
      } else {
        preencherInput(campoNome, nomeConta);
        relatorio.push({ item: 'Nome', resultado: `preenchido: ${nomeConta}` });
      }

      const cpf = acharCampoCPF(indice);
      if (!cpf) {
        relatorio.push({ item: 'CPF', resultado: 'CAMPO NÃO ENCONTRADO' });
      } else if (cpf.value.trim() && !SOBRESCREVER_CPF) {
        relatorio.push({ item: 'CPF', resultado: `mantido (${cpf.value})` });
      } else {
        const novo = gerarCPF();
        preencherInput(cpf, novo);
        relatorio.push({ item: 'CPF', resultado: `preenchido: ${novo}` });
      }

      await ligarLista(indice, LIGAR_PERMISSOES, relatorio);
      await sleep(400); // ligar "Administrador" pode mudar a tela
      indice = indexarRotulos();
      await ligarLista(indice, LIGAR_EMAILS, relatorio);
    } catch (e) {
      console.error('[GD4 auto]', e);
      relatorio.push({ item: 'Erro', resultado: String(e) });
    }

    console.table(relatorio);
    mostrarResultado(relatorio);
    if (btn) { btn.disabled = false; btn.textContent = '⚡ Preencher padrão'; }
  }

  // ---------- Interface ----------
  function mostrarResultado(relatorio) {
    const problemas = relatorio.filter((r) => /FALHOU|NÃO ENCONTRAD|Erro/.test(r.resultado));
    const cpfLinha = relatorio.find((r) => r.item === 'CPF');
    const nomeLinha = relatorio.find((r) => r.item === 'Nome');
    const box = document.getElementById('gd4-auto-toast') || document.createElement('div');
    box.id = 'gd4-auto-toast';
    Object.assign(box.style, {
      position: 'fixed', right: '20px', bottom: '72px', zIndex: 2147483647, maxWidth: '420px',
      background: problemas.length ? '#7a1f1f' : '#1f5f3a', color: '#fff', padding: '12px 14px',
      borderRadius: '8px', font: '13px/1.4 system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,.3)',
      whiteSpace: 'pre-wrap',
    });
    box.textContent = problemas.length
      ? `Atenção: ${problemas.length} item(ns) com problema:\n` +
        problemas.map((p) => `• ${p.item}: ${p.resultado}`).join('\n') +
        `\n\n${nomeLinha ? 'Nome ' + nomeLinha.resultado + '\n' : ''}${cpfLinha ? 'CPF ' + cpfLinha.resultado : ''}\n(Detalhes no Console, F12)`
      : `Tudo certo! ${nomeLinha ? 'Nome ' + nomeLinha.resultado + '. ' : ''}${cpfLinha ? 'CPF ' + cpfLinha.resultado + '.' : ''}\nConfira a tela e clique em Salvar.`;
    document.body.appendChild(box);
    clearTimeout(box._t);
    box._t = setTimeout(() => box.remove(), problemas.length ? 15000 : 6000);
  }

  function criarBotao() {
    if (document.getElementById('gd4-auto-ui')) return;
    const wrap = document.createElement('div');
    wrap.id = 'gd4-auto-ui';
    const btn = document.createElement('button');
    btn.id = 'gd4-auto-btn';
    btn.type = 'button';
    btn.textContent = '⚡ Preencher padrão';
    Object.assign(btn.style, {
      position: 'fixed', right: '20px', bottom: '20px', zIndex: 2147483647, padding: '10px 16px',
      background: '#1a73e8', color: '#fff', border: 'none', borderRadius: '6px', cursor: 'pointer',
      font: '600 14px system-ui, sans-serif', boxShadow: '0 2px 8px rgba(0,0,0,.25)',
    });
    btn.addEventListener('click', executar);
    wrap.appendChild(btn);
    document.body.appendChild(wrap);
  }

  function removerBotao() {
    const ui = document.getElementById('gd4-auto-ui');
    if (ui) ui.remove();
  }

  // Mostra o botão só na tela de cadastro de usuário (funciona mesmo se o GD4 trocar de tela sem recarregar).
  const marcador = norm(MARCADOR_TELA);
  function verificarTela() {
    const naTela = norm(document.body ? document.body.innerText : '').includes(marcador);
    naTela ? criarBotao() : removerBotao();
  }
  verificarTela();
  setInterval(verificarTela, 1500);

  window.gd4PreencherPadrao = executar; // permite rodar pelo Console também
})();
