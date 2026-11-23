(function () {
  "use strict";

  // ==========================================================================
  // CONFIGURAÇÃO
  // ==========================================================================

  // Imagem base (400x200) embutida em base64 pelo template.js
  const TEMPLATE_SRC = window.KLIOS_TEMPLATE_SRC;

  const STORAGE_KEY = "klios_sig_state";
  const STORAGE_KEY_POS = "klios_sig_debug_pos";

  // Modo ajuste: abra a página com ?debug=1
  const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";

  const ORANGE = "#F29624";
  const SITE_TEXT = "www.klios.com.br";

  // Posições medidas na imagem base (400x200).
  //   x, y     -> canto inferior esquerdo da linha de base do texto
  //   font     -> fonte e cor informadas no script original
  //   maxWidth -> largura disponível; se o texto não couber, a fonte diminui
  //               automaticamente até minSize
  // Referências medidas: barra do cargo x 195-383 / y 50-65; ícone do telefone
  // y 87-108; ícone do e-mail y 116-137; ícones terminam em x 225; ícone do
  // site x 205-238. Ajuste fino: abra a página com ?debug=1.
  const CONFIG = {
    name:  { x: 195, y: 39,  font: "bold 22px Arial, sans-serif", color: ORANGE,    maxWidth: 198, minSize: 11 },
    role:  { x: 200, y: 62,  font: "bold 13px Arial, sans-serif", color: "#FFFFFF", maxWidth: 178, minSize: 9 },
    phone: { x: 232, y: 102, font: "bold 12px Arial, sans-serif", color: ORANGE,    maxWidth: 163, minSize: 9 },
    email: { x: 232, y: 131, font: "bold 12px Arial, sans-serif", color: ORANGE,    maxWidth: 163, minSize: 9 },
    site:  { x: 243, y: 157, font: "bold 12px Arial, sans-serif", color: ORANGE,    maxWidth: 150, minSize: 9 },
  };

  // Textos usados quando o campo obrigatório fica vazio
  const DEFAULTS = { name: "Seu Nome Completo", role: "Seu Cargo" };

  // ==========================================================================
  // ESTADO E ELEMENTOS
  // ==========================================================================

  const dom = {
    canvas: document.getElementById("signatureCanvas"),
    canvasWrap: document.getElementById("canvasWrap"),
    inputName: document.getElementById("inputName"),
    inputRole: document.getElementById("inputRole"),
    inputPhone: document.getElementById("inputPhone"),
    inputEmail: document.getElementById("inputEmail"),
    btnCopy: document.getElementById("btnCopy"),
    btnDownload: document.getElementById("btnDownload"),
    toast: document.getElementById("toast"),
    // modo ajuste
    debugPanel: document.getElementById("debugPanel"),
    debugField: document.getElementById("debugField"),
    debugX: document.getElementById("debugX"),
    debugY: document.getElementById("debugY"),
    debugGrid: document.getElementById("debugGrid"),
    debugReadout: document.getElementById("debugReadout"),
    debugOutput: document.getElementById("debugOutput"),
    btnCopyConfig: document.getElementById("btnCopyConfig"),
  };

  const ctx = dom.canvas.getContext("2d");
  const templateImg = new Image();
  let templateReady = false;

  const state = { name: "", role: "", phone: "", email: "" };

  // ==========================================================================
  // UTILITÁRIOS
  // ==========================================================================

  // Máscara de telefone brasileiro: (11) 98765-4321 / (11) 3456-7890
  function maskPhone(value) {
    const d = (value || "").replace(/\D/g, "").slice(0, 11);
    if (d.length <= 2) return d.length ? `(${d}` : "";
    if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
    if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  }

  function isValidEmail(email) {
    return /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(email || "");
  }

  let toastTimer = null;
  function showToast(msg, type) {
    clearTimeout(toastTimer);
    dom.toast.textContent = msg;
    dom.toast.className = `toast toast-${type || "success"} show`;
    toastTimer = setTimeout(() => dom.toast.classList.remove("show"), 5000);
  }

  // ==========================================================================
  // DESENHO DA ASSINATURA
  // ==========================================================================

  // Reduz o tamanho da fonte até o texto caber na largura disponível
  function applyFittedFont(text, conf) {
    const match = conf.font.match(/(\d+(?:\.\d+)?)px/);
    if (!match) {
      ctx.font = conf.font;
      return;
    }
    let size = parseFloat(match[1]);
    const build = (s) => conf.font.replace(/(\d+(?:\.\d+)?)px/, `${s}px`);
    ctx.font = build(size);
    while (size > conf.minSize && ctx.measureText(text).width > conf.maxWidth) {
      size -= 0.5;
      ctx.font = build(size);
    }
  }

  function drawField(key, text) {
    if (!text) return;
    const conf = CONFIG[key];
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = conf.color;
    applyFittedFont(text, conf);
    // o 4º parâmetro comprime o texto se ainda não couber no tamanho mínimo
    ctx.fillText(text, conf.x, conf.y, conf.maxWidth);
  }

  function render() {
    if (!templateReady) return;
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    ctx.drawImage(templateImg, 0, 0, dom.canvas.width, dom.canvas.height);

    drawField("name", state.name || DEFAULTS.name);
    drawField("role", state.role || DEFAULTS.role);
    drawField("phone", state.phone);
    drawField("email", state.email);
    drawField("site", SITE_TEXT);

    if (DEBUG) drawOverlay(null);
  }

  // ==========================================================================
  // FORMULÁRIO
  // ==========================================================================

  function readForm() {
    state.name = dom.inputName.value.trim();
    state.role = dom.inputRole.value.trim();
    state.phone = dom.inputPhone.value.trim();
    state.email = dom.inputEmail.value.trim();
    dom.inputEmail.classList.toggle("input-invalid", !!state.email && !isValidEmail(state.email));
  }

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch (e) {
        console.warn("Não foi possível salvar localmente:", e);
      }
    }, 400);
  }

  function loadSaved() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!saved) return;
      ["name", "role", "phone", "email"].forEach((k) => {
        if (typeof saved[k] === "string") state[k] = saved[k];
      });
      dom.inputName.value = state.name;
      dom.inputRole.value = state.role;
      dom.inputPhone.value = state.phone;
      dom.inputEmail.value = state.email;
    } catch (e) {
      console.warn("Não foi possível carregar dados salvos:", e);
    }
  }

  function onInput() {
    readForm();
    render();
    scheduleSave();
  }

  // ==========================================================================
  // COPIAR E BAIXAR
  // ==========================================================================

  function canvasToBlob() {
    return new Promise((resolve, reject) => {
      dom.canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("toBlob vazio"))), "image/png");
    });
  }

  async function copyImage() {
    if (!navigator.clipboard || !window.ClipboardItem) {
      showToast("Este navegador não permite copiar imagem. Use \"Baixar PNG\" (Chrome ou Edge recomendados).", "info");
      return;
    }
    try {
      // A imagem é passada como promessa: assim funciona também no Safari
      await navigator.clipboard.write([new ClipboardItem({ "image/png": canvasToBlob() })]);
      showToast("Assinatura copiada! Cole (Ctrl + V) na assinatura do Outlook.", "success");
    } catch (err) {
      console.error("Falha ao copiar:", err);
      showToast("Não foi possível copiar. Permita o acesso à área de transferência ou use \"Baixar PNG\".", "error");
    }
  }

  async function downloadImage() {
    try {
      const blob = await canvasToBlob();
      const url = URL.createObjectURL(blob);
      const slug = (state.name || "assinatura")
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "assinatura";
      const link = document.createElement("a");
      link.href = url;
      link.download = `assinatura-klios-${slug}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("Imagem baixada com sucesso!", "success");
    } catch (err) {
      console.error("Falha ao baixar:", err);
      showToast("Não foi possível gerar a imagem.", "error");
    }
  }

  // ==========================================================================
  // MODO AJUSTE (somente com ?debug=1)
  // ==========================================================================

  let overlay = null;
  let overlayCtx = null;
  let hover = null;

  function loadDebugPositions() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY_POS) || "null");
      if (!saved) return;
      Object.keys(CONFIG).forEach((k) => {
        if (saved[k] && Number.isFinite(saved[k].x) && Number.isFinite(saved[k].y)) {
          CONFIG[k].x = saved[k].x;
          CONFIG[k].y = saved[k].y;
        }
      });
    } catch (e) { /* ignora */ }
  }

  function saveDebugPositions() {
    try {
      localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(positionsObject()));
    } catch (e) { /* ignora */ }
  }

  function positionsObject() {
    const out = {};
    Object.keys(CONFIG).forEach((k) => { out[k] = { x: CONFIG[k].x, y: CONFIG[k].y }; });
    return out;
  }

  function selectedKey() {
    return dom.debugField.value;
  }

  function refreshDebugPanel() {
    const c = CONFIG[selectedKey()];
    dom.debugX.value = c.x;
    dom.debugY.value = c.y;
    dom.debugOutput.textContent = JSON.stringify(positionsObject(), null, 2);
  }

  function drawOverlay(point) {
    if (!overlay) return;
    const w = overlay.width;
    const h = overlay.height;
    overlayCtx.clearRect(0, 0, w, h);

    if (dom.debugGrid.checked) {
      overlayCtx.lineWidth = 1;
      overlayCtx.font = "8px Arial";
      overlayCtx.textBaseline = "top";
      for (let x = 0; x <= w; x += 10) {
        overlayCtx.strokeStyle = x % 50 === 0 ? "rgba(0,120,255,0.45)" : "rgba(0,120,255,0.15)";
        overlayCtx.beginPath();
        overlayCtx.moveTo(x + 0.5, 0);
        overlayCtx.lineTo(x + 0.5, h);
        overlayCtx.stroke();
        if (x % 50 === 0) {
          overlayCtx.fillStyle = "rgba(0,80,200,0.9)";
          overlayCtx.fillText(String(x), x + 2, 1);
        }
      }
      for (let y = 0; y <= h; y += 10) {
        overlayCtx.strokeStyle = y % 50 === 0 ? "rgba(0,120,255,0.45)" : "rgba(0,120,255,0.15)";
        overlayCtx.beginPath();
        overlayCtx.moveTo(0, y + 0.5);
        overlayCtx.lineTo(w, y + 0.5);
        overlayCtx.stroke();
        if (y % 50 === 0 && y > 0) {
          overlayCtx.fillStyle = "rgba(0,80,200,0.9)";
          overlayCtx.fillText(String(y), 2, y + 1);
        }
      }
    }

    // marcas de cada campo (selecionado em azul-claro, demais em vermelho)
    Object.keys(CONFIG).forEach((k) => {
      const c = CONFIG[k];
      const selected = k === selectedKey();
      overlayCtx.strokeStyle = selected ? "#00b8d9" : "#ff3d71";
      overlayCtx.fillStyle = overlayCtx.strokeStyle;
      overlayCtx.lineWidth = selected ? 1.5 : 1;
      overlayCtx.beginPath();
      overlayCtx.moveTo(c.x - 5, c.y + 0.5);
      overlayCtx.lineTo(c.x + 5, c.y + 0.5);
      overlayCtx.moveTo(c.x + 0.5, c.y - 5);
      overlayCtx.lineTo(c.x + 0.5, c.y + 5);
      overlayCtx.stroke();
      overlayCtx.font = "bold 8px Arial";
      overlayCtx.textBaseline = "bottom";
      overlayCtx.fillText(k, c.x + 6, c.y - 3);
    });

    if (point) {
      overlayCtx.strokeStyle = "rgba(0,170,60,0.9)";
      overlayCtx.lineWidth = 1;
      overlayCtx.beginPath();
      overlayCtx.moveTo(point.x + 0.5, 0);
      overlayCtx.lineTo(point.x + 0.5, h);
      overlayCtx.moveTo(0, point.y + 0.5);
      overlayCtx.lineTo(w, point.y + 0.5);
      overlayCtx.stroke();
    }
  }

  function eventToPoint(e) {
    const rect = overlay.getBoundingClientRect();
    return {
      x: Math.round(((e.clientX - rect.left) * overlay.width) / rect.width),
      y: Math.round(((e.clientY - rect.top) * overlay.height) / rect.height),
    };
  }

  function moveSelected(dx, dy) {
    const c = CONFIG[selectedKey()];
    c.x = Math.round((c.x + dx) * 2) / 2;
    c.y = Math.round((c.y + dy) * 2) / 2;
    refreshDebugPanel();
    saveDebugPositions();
    render();
  }

  function initDebug() {
    loadDebugPositions();
    dom.debugPanel.hidden = false;

    overlay = document.createElement("canvas");
    overlay.id = "debugOverlay";
    overlay.width = dom.canvas.width;
    overlay.height = dom.canvas.height;
    dom.canvasWrap.appendChild(overlay);
    overlayCtx = overlay.getContext("2d");

    overlay.addEventListener("mousemove", (e) => {
      hover = eventToPoint(e);
      dom.debugReadout.textContent = `x: ${hover.x}, y: ${hover.y}`;
      drawOverlay(hover);
    });
    overlay.addEventListener("mouseleave", () => {
      hover = null;
      drawOverlay(null);
    });
    overlay.addEventListener("click", (e) => {
      const p = eventToPoint(e);
      const c = CONFIG[selectedKey()];
      c.x = p.x;
      c.y = p.y;
      refreshDebugPanel();
      saveDebugPositions();
      render();
    });

    dom.debugField.addEventListener("change", () => { refreshDebugPanel(); drawOverlay(hover); });
    dom.debugGrid.addEventListener("change", () => drawOverlay(hover));

    const onNumber = () => {
      const c = CONFIG[selectedKey()];
      const x = parseFloat(dom.debugX.value);
      const y = parseFloat(dom.debugY.value);
      if (Number.isFinite(x)) c.x = x;
      if (Number.isFinite(y)) c.y = y;
      dom.debugOutput.textContent = JSON.stringify(positionsObject(), null, 2);
      saveDebugPositions();
      render();
    };
    dom.debugX.addEventListener("input", onNumber);
    dom.debugY.addEventListener("input", onNumber);

    document.addEventListener("keydown", (e) => {
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      const step = e.shiftKey ? 5 : 1;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) {
        e.preventDefault();
        moveSelected(moves[e.key][0], moves[e.key][1]);
      }
    });

    dom.btnCopyConfig.addEventListener("click", async () => {
      const text = JSON.stringify(positionsObject(), null, 2);
      try {
        await navigator.clipboard.writeText(text);
        showToast("Posições copiadas!", "success");
      } catch (e) {
        showToast("Não foi possível copiar. Selecione o texto da caixa e use Ctrl + C.", "info");
      }
    });

    refreshDebugPanel();
  }

  // ==========================================================================
  // INICIALIZAÇÃO
  // ==========================================================================

  function init() {
    loadSaved();
    readForm();

    ["inputName", "inputRole", "inputEmail"].forEach((id) => dom[id].addEventListener("input", onInput));
    dom.inputPhone.addEventListener("input", () => {
      const masked = maskPhone(dom.inputPhone.value);
      if (masked !== dom.inputPhone.value) dom.inputPhone.value = masked;
      onInput();
    });

    dom.btnCopy.addEventListener("click", copyImage);
    dom.btnDownload.addEventListener("click", downloadImage);

    if (DEBUG) initDebug();

    if (!TEMPLATE_SRC) {
      showToast("Imagem base não encontrada (template.js).", "error");
      return;
    }
    templateImg.onload = () => {
      dom.canvas.width = templateImg.naturalWidth;
      dom.canvas.height = templateImg.naturalHeight;
      if (overlay) {
        overlay.width = dom.canvas.width;
        overlay.height = dom.canvas.height;
      }
      templateReady = true;
      render();
    };
    templateImg.onerror = () => showToast("Não foi possível carregar a imagem base.", "error");
    templateImg.src = TEMPLATE_SRC;
  }

  document.addEventListener("DOMContentLoaded", init);
})();
