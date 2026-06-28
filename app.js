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
        const maxPages = Math.min(pdf.numPages, 80);
        for (let i = 1; i <= maxPages; i++) {
          const page = await pdf.getPage(i);
          const content = await page.getTextContent();
          const pageText = content.items.map(item => item.str).join(' ');
          fullText += `\n--- Pagina ${i} ---\n${pageText}`;
        }
        if (pdf.numPages > 80) {
          fullText += `\n\n[Nota: documento di ${pdf.numPages} pagine. Analizzate le prime 80 pagine.]`;
        }
        resolve(fullText);
      } catch (err) {
        reject(err);
      }
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
  document.getElementById('file-ready').textContent = 'Elaborazione...';
  document.getElementById('file-ready').style.color = '#888';

  try {
    extractedText = await extractTextFromPDF(file);
    document.getElementById('file-ready').textContent = 'Documento pronto';
    document.getElementById('file-ready').style.color = '#2e7d32';
  } catch (err) {
    document.getElementById('file-ready').textContent = 'Errore lettura PDF';
    document.getElementById('file-ready').style.color = '#c62828';
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

async function callClaude(userMessage, systemPrompt) {
  const docContext = `Di seguito il testo estratto dal documento finanziario caricato dall'utente:\n\n${extractedText}\n\n---\n\n`;
  const messages = [
    ...qaHistory,
    { role: 'user', content: docContext + userMessage }
  ];

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
      max_tokens: 1000,
      system: systemPrompt,
      messages: messages
    })
  });
  const data = await response.json();
  if (data.error) throw new Error(data.error.message);
  return data.content.map(b => b.text || '').join('');
}

async function runQA() {
  const question = document.getElementById('question-input').value.trim();
  if (!question) return;
  if (!extractedText) { alert('Carica prima un documento PDF e attendi che sia elaborato.'); return; }
  if (!getApiKey()) { alert('Inserisci prima la chiave API.'); return; }

  const btn = document.getElementById('btn-qa');
  btn.disabled = true;

  const outputArea = document.getElementById('qa-output');
  outputArea.style.display = 'block';
  const historyEl = document.getElementById('qa-history');

  const itemEl = document.createElement('div');
  itemEl.className = 'history-item';
  itemEl.innerHTML = `<div class="history-q">${question}</div><div class="history-a">${loadingHTML()}</div>`;
  historyEl.appendChild(itemEl);
  itemEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const systemPrompt = `Sei un analista finanziario senior e revisore contabile esperto. Rispondi in italiano in modo preciso e professionale. Basa le tue risposte esclusivamente sul contenuto del documento fornito. Usa terminologia tecnica appropriata per ambito audit, bilancio IFRS e finanza aziendale. Sii conciso ma completo.`;

  try {
    const answer = await callClaude(question, systemPrompt);
    itemEl.querySelector('.history-a').textContent = answer;
    qaHistory.push({ role: 'user', content: question });
    qaHistory.push({ role: 'assistant', content: answer });
    if (qaHistory.length > 10) qaHistory = qaHistory.slice(-10);
    document.getElementById('question-input').value = '';
  } catch (err) {
    itemEl.querySelector('.history-a').textContent = 'Errore: ' + err.message;
  }

  btn.disabled = false;
}

async function runReport() {
  if (!extractedText) { alert('Carica prima un documento PDF e attendi che sia elaborato.'); return; }
  if (!getApiKey()) { alert('Inserisci prima la chiave API.'); return; }

  const reportTypes = {
    executive: 'Genera un executive summary professionale del documento. Struttura la risposta con: (1) Panoramica generale, (2) Dati finanziari chiave, (3) Punti di forza, (4) Criticità e aree di attenzione, (5) Conclusione sintetica.',
    risk: 'Analizza il documento e identifica tutte le aree di rischio in ottica di revisione contabile. Per ogni rischio classifica come ALTO / MEDIO / BASSO, descrivi l\'impatto e indica cosa un revisore dovrebbe approfondire.',
    ifrs: 'Analizza il documento in ottica IFRS. Per ogni principio rilevante (IFRS 15, 16, 9, IAS 16, IFRS 3, IAS 36, 37 ecc.) indica come viene applicato, eventuali non conformità e se la disclosure è adeguata.',
    kpi: 'Estrai i principali KPI economico-finanziari. Per ciascuno: valore riportato, trend vs periodo precedente, commento tecnico sulla significatività. Includi redditività, liquidità, solidità patrimoniale e indebitamento.'
  };

  const btn = document.getElementById('btn-report');
  btn.disabled = true;

  const outputArea = document.getElementById('report-output');
  const reportText = document.getElementById('report-text');
  outputArea.style.display = 'block';
  reportText.innerHTML = loadingHTML();

  const systemPrompt = `Sei un analista finanziario senior e revisore contabile esperto. Genera report professionali in italiano con terminologia tecnica appropriata, struttura chiara e tono formale adatto a contesti di audit e corporate finance.`;

  try {
    const result = await callClaude(reportTypes[selectedReport], systemPrompt);
    reportText.textContent = result;
  } catch (err) {
    reportText.textContent = 'Errore: ' + err.message;
  }

  btn.disabled = false;
}

document.getElementById('question-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    runQA();
  }
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
