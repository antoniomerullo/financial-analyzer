const API_URL = 'https://api.anthropic.com/v1/messages';

function getApiKey() {
  return localStorage.getItem('anthropic_api_key') || '';
}

let extractedText = null;
let currentTab = 'qa';
let selectedReport = 'executive';
let qaHistory = [];

async function extractTextFromPDF(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const typedArray = new Uint8Array(e.target.result);
        const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
        let fullText = '';
        const maxPages = Math.min(pdf.numPages, 120);
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          fullText += `\n--- Pagina ${i} ---\n` + content.items.map(item => item.str).join(' ');
        }
        if (pdf.numPages > 120) fullText += `\n\n[Documento di ${pdf.numPages} pagine. Analizzate le prime 120.]`;
        resolve(fullText);
      } catch (err) { reject(err); }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

document.getElementById('file-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  document.getElementById('file-name').textContent = file.name;
  document.getElementById('file-info').style.display = 'flex';
  document.getElementById('upload-zone').style.display = 'none';
  const badge = document.getElementById('file-ready');
  badge.textContent = 'Elaborazione in corso...';
  badge.style.color = '#888';
  badge.style.background = '#f5f5f5';
  try {
    extractedText = await extractTextFromPDF(file);
    badge.textContent = 'Documento pronto';
    badge.style.color = '#2e7d32';
    badge.style.background = '#e8f5e9';
  } catch (err) {
    badge.textContent = 'Errore lettura PDF';
    badge.style.color = '#c62828';
    badge.style.background = '#ffebee';
    extractedText = null;
  }
});

function removeFile() {
  extractedText = null;
  document.getElementById('file-input').value = '';
  document.getElementById('file-info').style.display = 'none';
  document.getElementById('upload-zone').style.display = '';
  clearHistory();
  document.getElementById('report-output').style.display = 'none';
}

function switchTab(tab) {
  currentTab = tab;
  document.getElementById('panel-qa').style.display = tab === 'qa' ? '' : 'none';
  document.getElementById('panel-report').style.display = tab === 'report' ? '' : 'none';
  document.getElementById('tab-qa').className = 'tab' + (tab === 'qa' ? ' active' : '');
  document.getElementById('tab-report').className = 'tab' + (tab === 'report' ? ' active' : '');
}

function selectReport(el, type) {
  selectedReport = type;
  document.querySelectorAll('.report-opt').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function clearHistory() {
  qaHistory = [];
  document.getElementById('qa-history').innerHTML = '';
  document.getElementById('qa-output').style.display = 'none';
}

function loadingHTML() {
  return '<div class="loading"><span></span><span></span><span></span></div>';
}

function renderMarkdown(text) {
  const lines = text.split('\n');
  let html = '';
  let inTable = false;
  let tableRows = [];

  function flushTable() {
    if (!tableRows.length) return;
    let th = '', tbody = '';
    tableRows.forEach((row, i) => {
      const cells = row.split('|').map(c => c.trim()).filter((c, idx, arr) => idx > 0 && idx < arr.length - 1);
      if (i === 0) {
        th = '<tr>' + cells.map(c => `<th>${renderInline(c)}</th>`).join('') + '</tr>';
      } else if (i === 1 && row.replace(/[\s|\-:]/g, '') === '') {
        // separator row, skip
      } else {
        tbody += '<tr>' + cells.map(c => `<td>${renderInline(c)}</td>`).join('') + '</tr>';
      }
    });
    html += `<div class="table-wrap"><table><thead>${th}</thead><tbody>${tbody}</tbody></table></div>`;
    tableRows = [];
    inTable = false;
  }

  function renderInline(t) {
    return t
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+?)\*/g, '<em>$1</em>')
      .replace(/🟢/g, '<span class="badge-green">🟢</span>')
      .replace(/🟡/g, '<span class="badge-yellow">🟡</span>')
      .replace(/🔴/g, '<span class="badge-red">🔴</span>')
      .replace(/⚪/g, '<span>⚪</span>');
  }

  lines.forEach(line => {
    if (line.trim().startsWith('|')) {
      inTable = true;
      tableRows.push(line.trim());
      return;
    }
    if (inTable) flushTable();

    if (line.startsWith('# ')) { html += `<h1>${renderInline(line.slice(2))}</h1>`; return; }
    if (line.startsWith('## ')) { html += `<h2>${renderInline(line.slice(3))}</h2>`; return; }
    if (line.startsWith('### ')) { html += `<h3>${renderInline(line.slice(4))}</h3>`; return; }
    if (line.startsWith('#### ')) { html += `<h4>${renderInline(line.slice(5))}</h4>`; return; }
    if (line.match(/^---+$/)) { html += '<hr>'; return; }
    if (line.startsWith('> ')) { html += `<blockquote>${renderInline(line.slice(2))}</blockquote>`; return; }
    if (line.startsWith('- ') || line.startsWith('* ')) { html += `<li>${renderInline(line.slice(2))}</li>`; return; }
    if (line.trim() === '') { html += '<div class="spacer"></div>'; return; }
    html += `<p>${renderInline(line)}</p>`;
  });

  if (inTable) flushTable();
  return html;
}

async function callClaude(userMessage, systemPrompt, isReport = false) {
  const docContext = `Testo estratto dal documento finanziario:\n\n${extractedText}\n\n---\n\nRichiesta: `;

  const messages = isReport
    ? [{ role: 'user', content: docContext + userMessage }]
    : [...qaHistory, { role: 'user', content: docContext + userMessage }];

  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': getApiKey(),
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 8000,
      system: systemPrompt,
      messages
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.map(b => b.text || '').join('');
}

async function runQA() {
  const question = document.getElementById('question-input').value.trim();
  if (!question) return;
  if (!extractedText) { alert('Carica prima un documento PDF.'); return; }
  if (!getApiKey()) { alert('Inserisci prima la chiave API.'); return; }

  const btn = document.getElementById('btn-qa');
  btn.disabled = true;
  document.getElementById('qa-output').style.display = 'block';
  const historyEl = document.getElementById('qa-history');

  const itemEl = document.createElement('div');
  itemEl.className = 'history-item';
  itemEl.innerHTML = `<div class="history-q">${question}</div><div class="history-a">${loadingHTML()}</div>`;
  historyEl.appendChild(itemEl);
  itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const systemPrompt = `Sei un analista finanziario senior e revisore contabile Big Four. Rispondi in italiano in modo preciso e professionale. Basa le risposte esclusivamente sul documento fornito. Usa terminologia tecnica IFRS e ISA Italia. Struttura le risposte con titoli Markdown (##, ###), tabelle (con | separatori), elenchi puntati (con -). Usa **grassetto** con doppi asterischi. Usa 🟢 🟡 🔴 per valutazioni. Completa SEMPRE la risposta per intero senza troncare.`;

  try {
    const answer = await callClaude(question, systemPrompt, false);
    itemEl.querySelector('.history-a').innerHTML = renderMarkdown(answer);
    qaHistory.push({ role: 'user', content: question });
    qaHistory.push({ role: 'assistant', content: answer });
    if (qaHistory.length > 10) qaHistory = qaHistory.slice(-10);
    document.getElementById('question-input').value = '';
  } catch (err) {
    itemEl.querySelector('.history-a').textContent = 'Errore: ' + err.message;
  }
  btn.disabled = false;
}

const REPORT_PROMPTS = {
  executive: `Genera un executive summary professionale e COMPLETO. Usa **grassetto** con doppi asterischi. Struttura OBBLIGATORIA:

# Executive Summary — [Nome Azienda] [Anno]

## 1. Panoramica generale
Business, mercati, modello operativo, contesto macroeconomico.

## 2. Dati finanziari chiave
| Indicatore | Anno corrente | Anno precedente | Var. % |
|---|---|---|---|
[inserisci almeno 8 righe con: Ricavi, EBITDA, EBIT, Utile netto, Cash Flow operativo, Capex, Debito netto, Patrimonio netto]

## 3. Struttura patrimoniale
| Indicatore | Valore | Note |
|---|---|---|
[Totale attivo, Patrimonio netto, Debito finanziario netto, Gearing ratio, Interest coverage]

## 4. Punti di forza
- **[Punto]:** descrizione dettagliata (almeno 5 punti)

## 5. Criticità e aree di attenzione
- 🔴 **[Rischio alto]:** descrizione
- 🟡 **[Rischio medio]:** descrizione
(almeno 4 punti)

## 6. Valutazione complessiva
**Giudizio:** 🟢 Positivo / 🟡 Neutro / 🔴 Critico
**Motivazione:** paragrafo di 4-5 righe con giudizio finale articolato.

IMPORTANTE: Completa tutte le sezioni. Non troncare mai il report.`,

  risk: `Genera un'analisi dei rischi di revisione COMPLETA secondo ISA Italia. Usa **grassetto** con doppi asterischi. Struttura OBBLIGATORIA:

# Analisi dei Rischi di Revisione — [Nome Azienda] [Anno]

## Premessa metodologica
ISA di riferimento applicati (ISA 315, 540, 550, 570 ecc.).

## 1. Quadro sinottico dei rischi
| # | Area di rischio | Classificazione | Riferimento |
|---|---|---|---|
[almeno 10 righe]

## 2. Analisi dettagliata per area
Per OGNI rischio identificato:
### Rischio N.X — [Nome] — 🔴/🟡/🟢
- **Descrizione:** spiegazione tecnica
- **Impatto potenziale:** quantificazione se disponibile
- **Area di bilancio:** voce interessata
- **Procedura di revisione:** cosa farebbe un auditor Big Four

## 3. Matrice di sintesi
| Area | Probabilità | Impatto | Priorità |
|---|---|---|---|

## 4. Conclusione e giudizio complessivo
Paragrafo finale con valutazione complessiva del rischio di revisione. 🟢/🟡/🔴

IMPORTANTE: Completa tutte le sezioni. Non troncare mai il report.`,

  ifrs: `Genera una checklist IFRS COMPLETA e dettagliata. Usa **grassetto** con doppi asterischi. Struttura OBBLIGATORIA:

# Checklist Conformità IFRS — [Nome Azienda] [Anno]

## 1. Framework di riferimento
Principi dichiarati nel documento.

## 2. Riepilogo conformità
| Principio | Applicabile | Conformità | Note critiche |
|---|---|---|---|
[almeno 10 principi: IFRS 15, IFRS 16, IFRS 9, IFRS 3, IAS 16, IAS 36, IAS 37, IAS 32, IAS 19, IAS 12]

## 3. Analisi per principio
Per OGNI principio rilevante:
### [Sigla] — [Titolo completo]
- **Applicabile:** Sì/No/Parziale
- **Trattamento adottato:** descrizione tecnica
- **Conformità:** 🟢 Conforme / 🟡 Parziale / 🔴 Non conforme / ⚪ Non verificabile
- **Aree di attenzione:** punti critici specifici
- **Qualità disclosure:** Adeguata / Da migliorare / Insufficiente

## 4. Valutazione complessiva disclosure
Giudizio sulla nota integrativa. 🟢/🟡/🔴

IMPORTANTE: Completa tutte le sezioni. Non troncare mai il report.`,

  kpi: `Genera un'analisi KPI COMPLETA e dettagliata. Usa **grassetto** con doppi asterischi. Struttura OBBLIGATORIA:

# Analisi KPI Economico-Finanziari — [Nome Azienda] [Anno]

## 1. Dashboard KPI
| KPI | Anno corrente | Anno precedente | Var. % | Valutazione |
|---|---|---|---|---|
[almeno 15 KPI con 🟢/🟡/🔴]

## 2. Indicatori di redditività
Per ciascuno (ROE, ROA, EBITDA margin, EBIT margin, Net margin):
### [Nome KPI]
- **Valore:** X%
- **Trend:** 🟢/🟡/🔴 rispetto anno precedente
- **Commento tecnico:** analisi di 2-3 righe

## 3. Indicatori di liquidità
Current ratio, Quick ratio, Cash ratio — stesso formato.

## 4. Indicatori di solidità patrimoniale
Debt/Equity, Gearing, Interest coverage, Debt/EBITDA — stesso formato.

## 5. Indicatori operativi settoriali
KPI specifici del settore dell'azienda analizzata.

## 6. Semaforo finale
| Area | 🟢/🟡/🔴 | Commento |
|---|---|---|
[Redditività, Liquidità, Solidità, Operativo, Complessivo]

IMPORTANTE: Completa tutte le sezioni. Non troncare mai il report.`
};

async function runReport() {
  if (!extractedText) { alert('Carica prima un documento PDF.'); return; }
  if (!getApiKey()) { alert('Inserisci prima la chiave API.'); return; }

  const btn = document.getElementById('btn-report');
  btn.disabled = true;
  document.getElementById('report-output').style.display = 'block';
  document.getElementById('report-text').innerHTML = loadingHTML();

  const systemPrompt = `Sei un analista finanziario senior di una Big Four (PwC/Deloitte/EY/KPMG). Genera report altamente professionali in italiano. REGOLE OBBLIGATORIE: 1) Usa **grassetto** SOLO con doppi asterischi **così**. 2) Le tabelle DEVONO avere il separatore | ad ogni cella incluse le celle vuote. 3) Usa 🟢 🟡 🔴 per ogni valutazione. 4) COMPLETA SEMPRE il report — non troncare mai. 5) Ogni sezione deve essere dettagliata e tecnica. 6) Cita sempre i dati numerici precisi dal documento.`;

  try {
    const result = await callClaude(REPORT_PROMPTS[selectedReport], systemPrompt, true);
    document.getElementById('report-text').innerHTML = renderMarkdown(result);
  } catch (err) {
    document.getElementById('report-text').textContent = 'Errore: ' + err.message;
  }
  btn.disabled = false;
}

document.getElementById('question-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runQA(); }
});

function saveKey() {
  const key = document.getElementById('api-key-input').value.trim();
  if (!key.startsWith('sk-ant-')) {
    document.getElementById('key-hint').textContent = 'Chiave non valida. Deve iniziare con sk-ant-...';
    document.getElementById('key-hint').className = 'key-hint';
    return;
  }
  localStorage.setItem('anthropic_api_key', key);
  document.getElementById('api-key-input').value = '••••••••••••••••••••';
  document.getElementById('key-hint').textContent = '✓ Chiave salvata. Puoi caricare un documento.';
  document.getElementById('key-hint').className = 'key-hint ok';
}

window.addEventListener('load', () => {
  const saved = localStorage.getItem('anthropic_api_key');
  if (saved) {
    document.getElementById('api-key-input').value = '••••••••••••••••••••';
    document.getElementById('key-hint').textContent = '✓ Chiave già salvata. Pronto.';
    document.getElementById('key-hint').className = 'key-hint ok';
  }
});
