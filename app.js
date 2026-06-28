const API_URL = 'https://api.anthropic.com/v1/messages';

function getApiKey() {
  return localStorage.getItem('anthropic_api_key') || '';
}

let pdfBase64 = null;
let currentTab = 'qa';
let selectedReport = 'executive';
let qaHistory = [];

document.getElementById('file-input').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    pdfBase64 = reader.result.split(',')[1];
    document.getElementById('file-name').textContent = file.name;
    document.getElementById('file-info').style.display = 'flex';
    document.getElementById('upload-zone').style.display = 'none';
  };
  reader.readAsDataURL(file);
});

function removeFile() {
  pdfBase64 = null;
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

async function callClaude(messages, systemPrompt) {
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
  if (!pdfBase64) { alert('Carica prima un documento PDF.'); return; }

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

  const systemPrompt = `Sei un analista finanziario senior e revisore contabile esperto. Rispondi in italiano in modo preciso e professionale. L'utente ti ha caricato un documento finanziario e ti fa domande su di esso. Basa le tue risposte esclusivamente sul contenuto del documento. Usa terminologia tecnica appropriata per ambito audit, bilancio IFRS e finanza aziendale. Sii conciso ma completo.`;

  const content = [
    { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
    { type: 'text', text: question }
  ];

  const messages = [...qaHistory.map(h => ({ role: h.role, content: h.content })), { role: 'user', content }];

  try {
    const answer = await callClaude(messages, systemPrompt);
    itemEl.querySelector('.history-a').textContent = answer;
    qaHistory.push({ role: 'user', content: [{ type: 'text', text: question }] });
    qaHistory.push({ role: 'assistant', content: answer });
    document.getElementById('question-input').value = '';
  } catch (err) {
    itemEl.querySelector('.history-a').textContent = 'Errore: ' + err.message;
  }

  btn.disabled = false;
}

async function runReport() {
  if (!pdfBase64) { alert('Carica prima un documento PDF.'); return; }

  const reportTypes = {
    executive: 'Genera un executive summary professionale del documento. Struttura la risposta con: (1) Panoramica generale, (2) Dati finanziari chiave, (3) Punti di forza, (4) Criticità e aree di attenzione, (5) Conclusione sintetica. Usa un formato chiaro con titoli di sezione.',
    risk: 'Analizza il documento e identifica tutte le aree di rischio rilevanti in ottica di revisione contabile. Per ogni rischio: classifica come ALTO / MEDIO / BASSO, descrivi l\'impatto potenziale e indica cosa un revisore dovrebbe approfondire. Considera rischi di bilancio, continuità aziendale, stime contabili e conformità IFRS.',
    ifrs: 'Analizza il documento in ottica IFRS. Per ogni principio contabile internazionale rilevante riscontrato (es. IFRS 15, IFRS 16, IFRS 9, IAS 16, IFRS 3, IAS 36, IAS 37 ecc.), indica: se e come viene applicato nel documento, eventuali aree di non conformità o punti di attenzione, e se la disclosure è adeguata.',
    kpi: 'Estrai e commenta i principali indicatori economico-finanziari presenti nel documento. Per ciascun KPI fornisci: il valore esatto riportato, il trend rispetto al periodo precedente (se disponibile), e un commento tecnico sulla significatività. Includi indicatori di redditività, liquidità, solidità patrimoniale e indebitamento.'
  };

  const btn = document.getElementById('btn-report');
  btn.disabled = true;

  const outputArea = document.getElementById('report-output');
  const reportText = document.getElementById('report-text');
  outputArea.style.display = 'block';
  reportText.innerHTML = loadingHTML();

  const systemPrompt = `Sei un analista finanziario senior e revisore contabile esperto. Genera report professionali in italiano con terminologia tecnica appropriata, struttura chiara e tono formale adatto a contesti di audit e corporate finance. Basa la tua analisi esclusivamente sul contenuto del documento fornito.`;

  const messages = [{
    role: 'user',
    content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
      { type: 'text', text: reportTypes[selectedReport] }
    ]
  }];

  try {
    const result = await callClaude(messages, systemPrompt);
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
