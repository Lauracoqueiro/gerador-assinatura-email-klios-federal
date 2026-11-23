(function () {
  "use strict";

  // ==========================================================================
  // CONFIGURAÇÃO
  // ==========================================================================

  // Imagem base (400x200) embutida em base64 pelo template.js
  const TEMPLATE_SRC = window.KLIOS_TEMPLATE_SRC;

  const STORAGE_KEY = "klios_sig_state";
  const STORAGE_KEY_POS = "klios_sig_debug_pos";
  const CORPORATE_DOMAIN = "@klios.com.br";

  const PARAMS = new URLSearchParams(window.location.search);
  const DEBUG = PARAMS.get("debug") === "1";

  const ORANGE = "#F29624";
  const SITE_TEXT = "www.klios.com.br";

  // Posições medidas na imagem base (400x200).
  //   x, y     -> canto inferior esquerdo da linha de base do texto
  //   font     -> fonte e cor informadas no script original
  //   maxWidth -> largura disponível; se o texto não couber, a fonte diminui
  //               automaticamente até minSize
  const CONFIG = {
    name:  { x: 195, y: 39,  font: "bold 22px Arial, sans-serif", color: ORANGE,    maxWidth: 198, minSize: 11 },
    role:  { x: 200, y: 62,  font: "bold 13px Arial, sans-serif", color: "#FFFFFF", maxWidth: 178, minSize: 9 },
    phone: { x: 232, y: 102, font: "bold 12px Arial, sans-serif", color: ORANGE,    maxWidth: 163, minSize: 9 },
    email: { x: 232, y: 131, font: "bold 12px Arial, sans-serif", color: ORANGE,    maxWidth: 163, minSize: 9 },
    site:  { x: 243, y: 157, font: "bold 12px Arial, sans-serif", color: ORANGE,    maxWidth: 150, minSize: 9 },
  };

  // Valores padrão (usados também no botão Limpar)
  const INITIAL_VALUES = {
    name: "Laura Coqueiro de Oliveira",
    role: "Suporte de TI",
    phone: "(62) 3414-1176",
    email: "laura.oliveira@klios.com.br",
  };
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
    btnResetForm: document.getElementById("btnResetForm"),
    toast: document.getElementById("toast"),
    // preenchimento mágico
    magicBox: document.getElementById("magicBox"),
    magicInput: document.getElementById("magicInput"),
    btnMagicFill: document.getElementById("btnMagicFill"),
    // score
    scoreValue: document.getElementById("scoreValue"),
    scoreFill: document.getElementById("scoreFill"),
    scoreList: document.getElementById("scoreList"),
    // modo TI / travamento
    lockedBanner: document.getElementById("lockedBanner"),
    btnUnlock: document.getElementById("btnUnlock"),
    tiInviteBox: document.getElementById("tiInviteBox"),
    chkLockFields: document.getElementById("chkLockFields"),
    btnCopyInvite: document.getElementById("btnCopyInvite"),
    btnCopyLink: document.getElementById("btnCopyLink"),
    // simulador multi-tela
    mockupShell: document.getElementById("mockupShell"),
    mockupTitle: document.getElementById("mockupTitle"),
    blockedPlaceholder: document.getElementById("blockedPlaceholder"),
    simTabs: document.querySelectorAll(".sim-tab"),
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
  let lastFittedSizes = { name: 22, role: 13 };

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

  async function copyPlainText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (!ok) throw new Error("copy failed");
  }

  // ==========================================================================
  // 1. PREENCHIMENTO MÁGICO ("Colar e Preencher")
  // ==========================================================================

  function parseMagicText(raw) {
    if (!raw || !raw.trim()) return null;
    let text = raw.replace(/\r\n/g, "\n");

    // 1) E-mail
    let email = "";
    const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/);
    if (emailMatch) {
      email = emailMatch[0];
      text = text.replace(email, "\n");
    }

    // 2) Telefone brasileiro (com ou sem +55, DDD e hífen/espaço)
    let phone = "";
    const phoneMatch = text.match(/(?:\+?55\s*)?(?:\(?\d{2}\)?\s*)?(?:9?\d{4})[-.\s]?\d{4}\b/);
    if (phoneMatch) {
      const digits = phoneMatch[0].replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
      if (digits.length >= 8) {
        phone = maskPhone(digits);
        text = text.replace(phoneMatch[0], "\n");
      }
    }

    // 3) Remove URLs e rótulos comuns antes de separar Nome e Cargo
    text = text.replace(/https?:\/\/\S+|www\.\S+/gi, "\n");
    const chunks = text
      .split(/[\n|•/]+|\s+[-–—]\s+/)
      .map((s) => s.replace(/^(?:nome|colaborador|cargo|fun[çc][ãa]o|tel(?:efone)?|whatsapp|cel(?:ular)?|e-?mail|contato)\s*[:\-]\s*/i, "").trim())
      .filter((s) => s.length >= 2 && !/^(?:ol[áa]|att|atenciosamente|klios(?:\s+tecnologia)?|[àa]\s+disposi[çc][ãa]o)[,!.\s]*$/i.test(s));

    return {
      name: chunks[0] || "",
      role: chunks[1] || "",
      phone,
      email,
    };
  }

  function applyMagicFill() {
    const parsed = parseMagicText(dom.magicInput.value);
    if (!parsed || (!parsed.name && !parsed.role && !parsed.phone && !parsed.email)) {
      showToast("Não encontrei dados reconhecíveis no texto colado.", "info");
      return;
    }
    if (parsed.name) dom.inputName.value = parsed.name.slice(0, 60);
    if (parsed.role) dom.inputRole.value = parsed.role.slice(0, 40);
    if (parsed.phone) dom.inputPhone.value = parsed.phone;
    if (parsed.email) dom.inputEmail.value = parsed.email.slice(0, 50);

    onInput();
    dom.magicBox.open = false;
    showToast("Campos preenchidos automaticamente! Confira a prévia.", "success");
  }

  // ==========================================================================
  // 2. DESENHO DA ASSINATURA
  // ==========================================================================

  // Reduz o tamanho da fonte até o texto caber na largura disponível
  function applyFittedFont(text, conf) {
    const match = conf.font.match(/(\d+(?:\.\d+)?)px/);
    if (!match) {
      ctx.font = conf.font;
      return 0;
    }
    let size = parseFloat(match[1]);
    const build = (s) => conf.font.replace(/(\d+(?:\.\d+)?)px/, `${s}px`);
    ctx.font = build(size);
    while (size > conf.minSize && ctx.measureText(text).width > conf.maxWidth) {
      size -= 0.5;
      ctx.font = build(size);
    }
    return size;
  }

  function drawField(key, text) {
    if (!text) return null;
    const conf = CONFIG[key];
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = conf.color;
    const usedSize = applyFittedFont(text, conf);
    ctx.fillText(text, conf.x, conf.y, conf.maxWidth);
    return usedSize;
  }

  function render() {
    if (!templateReady) return;
    ctx.clearRect(0, 0, dom.canvas.width, dom.canvas.height);
    ctx.drawImage(templateImg, 0, 0, dom.canvas.width, dom.canvas.height);

    lastFittedSizes.name = drawField("name", state.name || DEFAULTS.name) || 22;
    lastFittedSizes.role = drawField("role", state.role || DEFAULTS.role) || 13;
    drawField("phone", state.phone);
    drawField("email", state.email);
    drawField("site", SITE_TEXT);

    updateScore();
    if (DEBUG) drawOverlay(null);
  }

  // ==========================================================================
  // 3. DIAGNÓSTICO / SCORE EM TEMPO REAL
  // ==========================================================================

  function updateScore() {
    const phoneDigits = state.phone.replace(/\D/g, "");
    const checks = [
      {
        ok: state.name.length >= 3 && lastFittedSizes.name >= 14,
        label: !state.name
          ? "Informe o nome completo"
          : lastFittedSizes.name < 14
            ? "Nome muito longo (fonte reduzida para caber)"
            : "Nome com tamanho ideal",
      },
      {
        ok: state.role.length >= 2 && lastFittedSizes.role >= 10,
        label: !state.role
          ? "Informe o cargo"
          : lastFittedSizes.role < 10
            ? "Cargo muito longo para a barra azul"
            : "Cargo alinhado na barra",
      },
      {
        ok: phoneDigits.length === 10 || phoneDigits.length === 11,
        label: !state.phone
          ? "Telefone em branco (opcional)"
          : phoneDigits.length < 10
            ? "Telefone sem DDD completo"
            : "Telefone com DDD válido",
      },
      {
        ok: isValidEmail(state.email) && state.email.toLowerCase().endsWith(CORPORATE_DOMAIN),
        label: !state.email
          ? "E-mail em branco (opcional)"
          : !isValidEmail(state.email)
            ? "Formato de e-mail inválido"
            : !state.email.toLowerCase().endsWith(CORPORATE_DOMAIN)
              ? `E-mail fora do domínio ${CORPORATE_DOMAIN}`
              : `E-mail corporativo ${CORPORATE_DOMAIN}`,
      },
    ];

    const passed = checks.filter((c) => c.ok).length;
    const pct = Math.round((passed / checks.length) * 100);
    const isWarn = pct < 100;

    dom.scoreValue.textContent = `${pct}%`;
    dom.scoreValue.classList.toggle("warn", isWarn);
    dom.scoreFill.style.width = `${pct}%`;
    dom.scoreFill.classList.toggle("warn", isWarn);

    dom.scoreList.innerHTML = checks
      .map((c) => `<li class="${c.ok ? "ok" : "warn"}">${c.ok ? "&#10003;" : "&#9888;"} ${c.label}</li>`)
      .join("");
  }

  // ==========================================================================
  // 4. SIMULADOR MULTI-TELA
  // ==========================================================================

  const SIM_TITLES = {
    desktop: "NOVA MENSAGEM — OUTLOOK / WEBMAIL",
    mobile: "CELULAR (340PX) — VISUALIZAÇÃO",
    dark: "MODO ESCURO — OUTLOOK / GMAIL",
    blocked: "IMAGENS BLOQUEADAS PELO DESTINATÁRIO",
  };

  function setSimMode(mode) {
    dom.mockupShell.dataset.mode = mode;
    dom.mockupTitle.textContent = SIM_TITLES[mode] || SIM_TITLES.desktop;
    dom.simTabs.forEach((btn) => {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-selected", String(active));
    });
    const isBlocked = mode === "blocked";
    dom.canvas.hidden = isBlocked;
    dom.blockedPlaceholder.hidden = !isBlocked;
  }

  // ==========================================================================
  // 5. FORMULÁRIO, URL E MODO TI (Convite Pronto)
  // ==========================================================================

  function readForm() {
    state.name = dom.inputName.value.trim();
    state.role = dom.inputRole.value.trim();
    state.phone = dom.inputPhone.value.trim();
    state.email = dom.inputEmail.value.trim();
    dom.inputEmail.classList.toggle("input-invalid", !!state.email && !isValidEmail(state.email));
  }

  function applyValuesToInputs(vals) {
    if (typeof vals.name === "string") dom.inputName.value = vals.name;
    if (typeof vals.role === "string") dom.inputRole.value = vals.role;
    if (typeof vals.phone === "string") dom.inputPhone.value = maskPhone(vals.phone);
    if (typeof vals.email === "string") dom.inputEmail.value = vals.email;
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

  function setLockedMode(locked) {
    [dom.inputName, dom.inputRole, dom.inputPhone, dom.inputEmail].forEach((el) => {
      el.disabled = locked;
    });
    dom.lockedBanner.hidden = !locked;
    dom.magicBox.hidden = locked;
    dom.tiInviteBox.hidden = locked;
    dom.btnResetForm.hidden = locked;
  }

  function loadInitialState() {
    const hasQuery = ["nome", "cargo", "tel", "email"].some((k) => PARAMS.has(k));
    if (hasQuery) {
      applyValuesToInputs({
        name: PARAMS.get("nome") ?? "",
        role: PARAMS.get("cargo") ?? "",
        phone: PARAMS.get("tel") ?? "",
        email: PARAMS.get("email") ?? "",
      });
      if (PARAMS.get("travado") === "1" || PARAMS.get("locked") === "1") {
        setLockedMode(true);
      }
      return;
    }

    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (saved) applyValuesToInputs(saved);
    } catch (e) {
      console.warn("Não foi possível carregar dados salvos:", e);
    }
  }

  function buildInviteUrl() {
    const url = new URL(window.location.href);
    url.search = "";
    if (state.name) url.searchParams.set("nome", state.name);
    if (state.role) url.searchParams.set("cargo", state.role);
    if (state.phone) url.searchParams.set("tel", state.phone);
    if (state.email) url.searchParams.set("email", state.email);
    if (dom.chkLockFields.checked) url.searchParams.set("travado", "1");
    return url.toString();
  }

  async function copyInvite(withMessage) {
    readForm();
    const link = buildInviteUrl();
    const firstName = (state.name || "colega").split(/\s+/)[0];
    const payload = withMessage
      ? `Olá, ${firstName}! Sua assinatura corporativa da KLIOS já está pronta:\n\n1. Abra o link: ${link}\n2. Clique em "Copiar assinatura (imagem)"\n3. Cole com Ctrl + V nas configurações de assinatura do Outlook.`
      : link;
    try {
      await copyPlainText(payload);
      showToast(withMessage ? "Convite + link copiados para enviar no WhatsApp/Teams!" : "Link preenchido copiado!", "success");
    } catch (e) {
      showToast("Não foi possível copiar o link automaticamente.", "error");
    }
  }

  function resetForm() {
    applyValuesToInputs(INITIAL_VALUES);
    dom.magicInput.value = "";
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignora */ }
    readForm();
    render();
    showToast("Campos restaurados para o padrão.", "info");
  }

  function onInput() {
    readForm();
    render();
    scheduleSave();
  }

  // ==========================================================================
  // 6. COPIAR E BAIXAR PNG
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
  // 7. MODO AJUSTE (somente com ?debug=1)
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
      try {
        await copyPlainText(JSON.stringify(positionsObject(), null, 2));
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
    loadInitialState();
    readForm();
    updateScore();

    ["inputName", "inputRole", "inputEmail"].forEach((id) => dom[id].addEventListener("input", onInput));
    dom.inputPhone.addEventListener("input", () => {
      const masked = maskPhone(dom.inputPhone.value);
      if (masked !== dom.inputPhone.value) dom.inputPhone.value = masked;
      onInput();
    });

    dom.btnCopy.addEventListener("click", copyImage);
    dom.btnDownload.addEventListener("click", downloadImage);
    dom.btnResetForm.addEventListener("click", resetForm);
    dom.btnMagicFill.addEventListener("click", applyMagicFill);
    dom.btnUnlock.addEventListener("click", () => setLockedMode(false));
    dom.btnCopyInvite.addEventListener("click", () => copyInvite(true));
    dom.btnCopyLink.addEventListener("click", () => copyInvite(false));
    dom.simTabs.forEach((btn) => btn.addEventListener("click", () => setSimMode(btn.dataset.mode)));

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
