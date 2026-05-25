/**
 * EmojiRepo - JavaScript Core
 * Aplicação estática de esteganografia em caracteres Unicode invisíveis.
 */

// Registrar Service Worker para suporte PWA offline
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker registrado com sucesso:', reg.scope))
      .catch(err => console.error('Falha ao registrar Service Worker:', err));
  });
}

// Configurações Globais
const CONFIG = {
  ANCHOR_EMOJI: '😀',
  // Variation Selectors Supplement (U+E0100 a U+E010F) para codificação Base16 (nibbles)
  CODEPOINT_START: 0xE0100,
};

// Estado da Aplicação
const state = {
  activeZipBuffer: null,
  activeZipName: 'projeto.zip',
  activeInvisiblePayload: null,
  decodedZipBuffer: null
};

// Elementos do DOM
const DOM = {
  terminalLogs: document.getElementById('terminal-logs'),
  btnClearLogs: document.getElementById('btn-clear-logs'),
  
  // Encode
  githubUrl: document.getElementById('github-url'),
  zipDropZone: document.getElementById('zip-drop-zone'),
  zipZoneText: document.getElementById('zip-zone-text'),
  zipFileInput: document.getElementById('zip-file-input'),
  useCompression: document.getElementById('use-compression'),
  extremeInvisible: document.getElementById('extreme-invisible'),
  btnEncode: document.getElementById('btn-encode'),
  encodeProgressContainer: document.getElementById('encode-progress-container'),
  encodeProgressBar: document.getElementById('encode-progress-bar'),
  encodeProgressText: document.getElementById('encode-progress-text'),
  encodeProgressPercent: document.getElementById('encode-progress-percent'),
  encodeResultBox: document.getElementById('encode-result-box'),
  encodeResultEmoji: document.getElementById('encode-result-emoji'),
  encodeStatOriginal: document.getElementById('encode-stat-original'),
  encodeStatInvisible: document.getElementById('encode-stat-invisible'),
  encodeStatSha: document.getElementById('encode-stat-sha'),
  btnCopyEmoji: document.getElementById('btn-copy-emoji'),
  btnDownloadTxt: document.getElementById('btn-download-txt'),

  // Decode
  txtDropZone: document.getElementById('txt-drop-zone'),
  txtZoneText: document.getElementById('txt-zone-text'),
  txtFileInput: document.getElementById('txt-file-input'),
  btnDecode: document.getElementById('btn-decode'),
  decodeProgressContainer: document.getElementById('decode-progress-container'),
  decodeProgressBar: document.getElementById('decode-progress-bar'),
  decodeProgressText: document.getElementById('decode-progress-text'),
  decodeProgressPercent: document.getElementById('decode-progress-percent'),
  decodeResultBox: document.getElementById('decode-result-box'),
  decodeStatSize: document.getElementById('decode-stat-size'),
  decodeStatIntegrity: document.getElementById('decode-stat-integrity'),
  decodeStatSha: document.getElementById('decode-stat-sha'),
  btnDownloadRestored: document.getElementById('btn-download-restored'),

  // CLI Download
  btnDownloadCli: document.getElementById('btn-download-cli')
};

/* ==========================================================================
   SISTEMA DE LOGS TIPO TERMINAL
   ========================================================================== */
function log(message, type = 'info') {
  const line = document.createElement('div');
  line.className = 'log-line';
  
  const time = document.createElement('span');
  time.className = 'log-time';
  const now = new Date();
  time.textContent = `[${now.toTimeString().split(' ')[0]}]`;
  
  const content = document.createElement('span');
  content.className = `log-${type}`;
  content.textContent = `> ${message}`;
  
  line.appendChild(time);
  line.appendChild(content);
  DOM.terminalLogs.appendChild(line);
  DOM.terminalLogs.scrollTop = DOM.terminalLogs.scrollHeight;
}

DOM.btnClearLogs.addEventListener('click', () => {
  DOM.terminalLogs.innerHTML = '';
  log('Terminal limpo.', 'info');
});

// Log Inicial
log('EmojiRepo carregado com sucesso. Pronto para operações.', 'success');
log('Sistema operacional offline habilitado via Cache API.', 'info');

/* ==========================================================================
   FUNÇÕES AUXILIARES DE CRIPTOGRAFIA E UTILITÁRIOS
   ========================================================================== */

// Calcula o Hash SHA-256 de um Uint8Array
async function calculateSHA256(buffer) {
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Formatação amigável de tamanho de bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/* ==========================================================================
   ALGORITMO DE ESTEGANOGRAFIA UNICODE INVISÍVEL
   ========================================================================== */

/**
 * Codifica um Uint8Array em uma String invisível.
 * Cada byte é dividido em 2 nibbles (4 bits cada) mapeados para a faixa U+E0100 a U+E010F.
 */
function encodeBytesToInvisible(bytes, onProgress) {
  const len = bytes.length;
  let result = '';
  const chunkSize = 16384; // Processamento em blocos para evitar travar a UI
  
  for (let i = 0; i < len; i += chunkSize) {
    const end = Math.min(i + chunkSize, len);
    for (let j = i; j < end; j++) {
      const byte = bytes[j];
      const highNibble = (byte >> 4) & 0x0F;
      const lowNibble = byte & 0x0F;
      result += String.fromCodePoint(CONFIG.CODEPOINT_START + highNibble);
      result += String.fromCodePoint(CONFIG.CODEPOINT_START + lowNibble);
    }
    if (onProgress) {
      onProgress(Math.min(100, Math.round((end / len) * 100)));
    }
  }
  return result;
}

/**
 * Decodifica uma string com caracteres invisíveis de volta para Uint8Array.
 */
function decodeInvisibleToBytes(str, onProgress) {
  // Filtra apenas os code points válidos da nossa faixa
  const codePoints = [];
  const len = str.length;
  
  // Usamos o iterador de strings para lidar corretamente com code points substitutos de 32 bits
  for (const char of str) {
    const cp = char.codePointAt(0);
    if (cp >= CONFIG.CODEPOINT_START && cp <= CONFIG.CODEPOINT_START + 0x0F) {
      codePoints.push(cp - CONFIG.CODEPOINT_START);
    }
  }
  
  if (codePoints.length % 2 !== 0) {
    throw new Error('Payload corrompido: quantidade ímpar de caracteres invisíveis detectada.');
  }
  
  const totalBytes = codePoints.length / 2;
  const bytes = new Uint8Array(totalBytes);
  const chunkSize = 16384;
  
  for (let i = 0; i < totalBytes; i += chunkSize) {
    const end = Math.min(i + chunkSize, totalBytes);
    for (let j = i; j < end; j++) {
      const high = codePoints[j * 2];
      const low = codePoints[j * 2 + 1];
      bytes[j] = (high << 4) | low;
    }
    if (onProgress) {
      onProgress(Math.min(100, Math.round((end / totalBytes) * 100)));
    }
  }
  
  return bytes;
}

/* ==========================================================================
   ESTRUTURAÇÃO DO PAYLOAD
   ========================================================================== */

/**
 * Monta o buffer final que será codificado.
 * Estrutura:
 * [1 byte: Flags] -> bit 0: Compressão (1 = Sim, 0 = Não)
 * [32 bytes: SHA-256 original]
 * [Resto: Dados ZIP (brutos ou comprimidos)]
 */
async function buildPayloadBuffer(zipBytes, useComp) {
  const sha256Hex = await calculateSHA256(zipBytes);
  log(`SHA-256 do arquivo original calculado: ${sha256Hex}`, 'info');
  
  // Converter string Hex de SHA-256 para Uint8Array
  const shaBytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    shaBytes[i] = parseInt(sha256Hex.substr(i * 2, 2), 16);
  }
  
  let dataBytes = zipBytes;
  let isCompressed = 0;
  
  if (useComp) {
    if (typeof pako !== 'undefined') {
      log('Comprimindo arquivo com Pako.js...', 'info');
      dataBytes = pako.gzip(zipBytes);
      isCompressed = 1;
      log(`Compressão concluída. Redução: de ${formatBytes(zipBytes.length)} para ${formatBytes(dataBytes.length)}`, 'success');
    } else {
      log('Pako.js não está carregado. Prosseguindo sem compressão.', 'warn');
    }
  }
  
  const payload = new Uint8Array(1 + 32 + dataBytes.length);
  payload[0] = isCompressed;
  payload.set(shaBytes, 1);
  payload.set(dataBytes, 33);
  
  return { payload, sha256Hex };
}

/**
 * Desmonta o buffer decodificado.
 */
function parsePayloadBuffer(payloadBytes) {
  if (payloadBytes.length < 33) {
    throw new Error('Tamanho do payload inválido. Arquivo possivelmente corrompido.');
  }
  
  const isCompressed = payloadBytes[0] & 0x01;
  
  const shaBytes = payloadBytes.subarray(1, 33);
  const sha256Hex = Array.from(shaBytes).map(b => b.toString(16).padStart(2, '0')).join('');
  
  let dataBytes = payloadBytes.subarray(33);
  
  if (isCompressed) {
    log('Descompactando dados comprimidos...', 'info');
    if (typeof pako !== 'undefined') {
      dataBytes = pako.ungzip(dataBytes);
      log('Descompressão executada com sucesso.', 'success');
    } else {
      throw new Error('Não é possível descompactar: Biblioteca Pako.js indisponível offline.');
    }
  }
  
  return { zipBytes: dataBytes, expectedSha: sha256Hex };
}

/* ==========================================================================
   GERENCIAMENTO DE DRAG & DROP E ARQUIVOS
   ========================================================================== */

// Configuração Drag-and-Drop do ZIP (Encode)
setupDragAndDrop(DOM.zipDropZone, DOM.zipZoneText, DOM.zipFileInput, (file) => {
  if (file.name.endsWith('.zip')) {
    state.activeZipName = file.name;
    const reader = new FileReader();
    reader.onload = (e) => {
      state.activeZipBuffer = new Uint8Array(e.target.result);
      log(`Arquivo ZIP carregado localmente: ${file.name} (${formatBytes(state.activeZipBuffer.length)})`, 'success');
    };
    reader.readAsArrayBuffer(file);
  } else {
    log('Por favor, envie apenas arquivos com extensão .zip!', 'error');
  }
});

// Configuração Drag-and-Drop do emoji.txt (Decode)
setupDragAndDrop(DOM.txtDropZone, DOM.txtZoneText, DOM.txtFileInput, (file) => {
  if (file.name.endsWith('.txt')) {
    const reader = new FileReader();
    reader.onload = (e) => {
      state.activeInvisiblePayload = e.target.result;
      log(`Arquivo de texto carregado para decodificação: ${file.name} (${formatBytes(state.activeInvisiblePayload.length)} caracteres)`, 'info');
      DOM.btnDecode.removeAttribute('disabled');
    };
    reader.readAsText(file);
  } else {
    log('Por favor, envie apenas arquivos .txt com steganografia de emoji!', 'error');
  }
});

function setupDragAndDrop(dropZone, zoneText, fileInput, onFileRead) {
  dropZone.addEventListener('click', () => fileInput.click());
  
  fileInput.addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      const file = e.target.files[0];
      zoneText.textContent = `${file.name} (${formatBytes(file.size)})`;
      onFileRead(file);
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });

  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
  });

  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      zoneText.textContent = `${file.name} (${formatBytes(file.size)})`;
      onFileRead(file);
    }
  });
}

/* ==========================================================================
   DOWNLOAD DE ZIP DO GITHUB
   ========================================================================== */

async function downloadGithubZip(repoUrl) {
  // Sanitizar e extrair usuário e repositório
  const cleanUrl = repoUrl.trim().replace(/\/$/, "");
  const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
  if (!match) {
    throw new Error('Link do GitHub inválido. Use o formato: https://github.com/usuario/repositorio');
  }
  
  const user = match[1];
  const repo = match[2];
  state.activeZipName = `${repo}-master.zip`;
  
  log(`Iniciando detecção do repositório ${user}/${repo}...`, 'info');
  
  const branches = ['main', 'master'];
  
  // Lista de proxies de CORS gratuitos e rápidos para tentar em fallback
  const proxyTemplates = [
    url => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
    url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    url => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(url)}`
  ];
  
  let lastError = null;
  
  for (const branch of branches) {
    const downloadUrl = `https://github.com/${user}/${repo}/archive/refs/heads/${branch}.zip`;
    
    // Tenta cada proxy de CORS disponível
    for (let p = 0; p < proxyTemplates.length; p++) {
      const proxyUrl = proxyTemplates[p](downloadUrl);
      log(`Tentando baixar branch '${branch}' via proxy #${p + 1}...`, 'info');
      
      try {
        const response = await fetch(proxyUrl);
        if (!response.ok) {
          throw new Error(`Código HTTP ${response.status}`);
        }
        const buffer = await response.arrayBuffer();
        
        // Verifica se a resposta não é uma página HTML de erro curta
        if (buffer.byteLength < 500) {
          throw new Error("Arquivo ZIP inválido ou muito curto (possível página de erro).");
        }
        
        log(`Sucesso! Repositório obtido via proxy CORS #${p + 1}.`, 'success');
        return new Uint8Array(buffer);
      } catch (err) {
        log(`Proxy #${p + 1} falhou para branch '${branch}': ${err.message}`, 'warn');
        lastError = err;
      }
    }
  }
  
  throw new Error(`Não foi possível baixar o repositório por nenhum proxy CORS. Último erro: ${lastError.message}`);
}

/* ==========================================================================
   FLUXOS PRINCIPAIS DE ENCODE & DECODE
   ========================================================================== */

// Ação de Encode
DOM.btnEncode.addEventListener('click', async () => {
  try {
    DOM.btnEncode.setAttribute('disabled', 'true');
    DOM.encodeResultBox.style.display = 'none';
    DOM.encodeProgressContainer.style.display = 'block';
    
    let zipBytes = state.activeZipBuffer;
    
    // Se o usuário digitou uma URL do GitHub, baixa primeiro
    if (DOM.githubUrl.value.trim() !== '') {
      log('Buscando repositório remoto...', 'info');
      DOM.encodeProgressPercent.textContent = 'Buscando...';
      zipBytes = await downloadGithubZip(DOM.githubUrl.value);
    }
    
    if (!zipBytes) {
      throw new Error('Nenhum arquivo ZIP foi carregado nem link do GitHub foi inserido.');
    }
    
    DOM.encodeProgressText.textContent = 'Preparando payload...';
    const useComp = DOM.useCompression.checked;
    const { payload, sha256Hex } = await buildPayloadBuffer(zipBytes, useComp);
    
    DOM.encodeProgressText.textContent = 'Codificando em caracteres invisíveis...';
    
    // Codificação
    const invisibleText = encodeBytesToInvisible(payload, (percent) => {
      DOM.encodeProgressBar.style.width = `${percent}%`;
      DOM.encodeProgressPercent.textContent = `${percent}%`;
    });
    
    // Decidir se adiciona emoji âncora ou não
    const isExtreme = DOM.extremeInvisible.checked;
    const finalPayload = isExtreme ? invisibleText : CONFIG.ANCHOR_EMOJI + invisibleText;
    state.activeInvisiblePayload = finalPayload;
    
    log(`Codificação concluída. Payload esteganográfico preparado!`, 'success');
    
    // Mostrar resultados
    DOM.encodeProgressContainer.style.display = 'none';
    DOM.encodeResultBox.style.display = 'block';
    DOM.encodeResultEmoji.textContent = isExtreme ? '[Payload Invisível Puro]' : CONFIG.ANCHOR_EMOJI;
    DOM.encodeStatOriginal.textContent = formatBytes(zipBytes.length);
    DOM.encodeStatInvisible.textContent = finalPayload.length;
    DOM.encodeStatSha.textContent = sha256Hex;
    
  } catch (err) {
    log(err.message, 'error');
    DOM.encodeProgressContainer.style.display = 'none';
  } finally {
    DOM.btnEncode.removeAttribute('disabled');
  }
});

// Copiar Emoji para Clipboard
DOM.btnCopyEmoji.addEventListener('click', () => {
  if (state.activeInvisiblePayload) {
    navigator.clipboard.writeText(state.activeInvisiblePayload)
      .then(() => {
        log('Payload copiado para a área de transferência!', 'success');
      })
      .catch(err => {
        log('Falha ao copiar payload automaticamente. Copie do arquivo gerado.', 'error');
      });
  }
});

// Baixar emoji.txt
DOM.btnDownloadTxt.addEventListener('click', () => {
  if (state.activeInvisiblePayload) {
    const blob = new Blob([state.activeInvisiblePayload], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emoji.txt';
    a.click();
    URL.revokeObjectURL(url);
    log('Arquivo emoji.txt baixado.', 'success');
  }
});

// Ação de Decode
DOM.btnDecode.addEventListener('click', async () => {
  try {
    DOM.btnDecode.setAttribute('disabled', 'true');
    DOM.decodeResultBox.style.display = 'none';
    DOM.decodeProgressContainer.style.display = 'block';
    DOM.decodeProgressText.textContent = 'Decodificando caracteres invisíveis...';
    
    if (!state.activeInvisiblePayload) {
      throw new Error('Nenhum payload de texto carregado para decodificar.');
    }
    
    // Decodifica
    const payloadBytes = decodeInvisibleToBytes(state.activeInvisiblePayload, (percent) => {
      DOM.decodeProgressBar.style.width = `${percent}%`;
      DOM.decodeProgressPercent.textContent = `${percent}%`;
    });
    
    DOM.decodeProgressText.textContent = 'Verificando integridade e extraindo ZIP...';
    
    const { zipBytes, expectedSha } = parsePayloadBuffer(payloadBytes);
    
    // Validação de Checksum
    const decodedSha = await calculateSHA256(zipBytes);
    if (decodedSha !== expectedSha) {
      log('ALERTA: Falha de integridade! Checksum SHA-256 não confere.', 'error');
      DOM.decodeStatIntegrity.textContent = 'CORROMPIDO!';
      DOM.decodeStatIntegrity.style.color = 'var(--neon-red)';
    } else {
      log('Integridade verificada com sucesso via checksum SHA-256.', 'success');
      DOM.decodeStatIntegrity.textContent = 'INTEGRIDADE VERIFICADA';
      DOM.decodeStatIntegrity.style.color = 'var(--neon-green)';
    }
    
    state.decodedZipBuffer = zipBytes;
    
    // Mostrar resultados
    DOM.decodeProgressContainer.style.display = 'none';
    DOM.decodeResultBox.style.display = 'block';
    DOM.decodeStatSize.textContent = formatBytes(zipBytes.length);
    DOM.decodeStatSha.textContent = expectedSha;
    
    // Download automático imediato
    triggerRestoredZipDownload();
    
  } catch (err) {
    log(err.message, 'error');
    DOM.decodeProgressContainer.style.display = 'none';
  } finally {
    DOM.btnDecode.removeAttribute('disabled');
  }
});

// Baixar Projeto Restaurado manualmente
DOM.btnDownloadRestored.addEventListener('click', triggerRestoredZipDownload);

function triggerRestoredZipDownload() {
  if (state.decodedZipBuffer) {
    const blob = new Blob([state.decodedZipBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'projeto_restaurado.zip';
    a.click();
    URL.revokeObjectURL(url);
    log('Projeto original restaurado com sucesso e baixado (projeto_restaurado.zip).', 'success');
  }
}

// Ação para baixar o script Python CLI
DOM.btnDownloadCli.addEventListener('click', async () => {
  try {
    log('Iniciando transferência do script Python CLI...', 'info');
    const response = await fetch('./emojirepo.py.txt');
    if (!response.ok) {
      throw new Error(`Código de status ${response.status}`);
    }
    const text = await response.text();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'emojirepo.py';
    a.click();
    URL.revokeObjectURL(url);
    log('Script Python CLI (emojirepo.py) baixado com sucesso!', 'success');
  } catch (err) {
    log(`Falha ao baixar script Python: ${err.message}`, 'error');
  }
});
