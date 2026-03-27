// server/routes/deploy-ui.ts
// Shared deploy UI components for export pages.
// Each mode calls these to get CSS, toolbar HTML, modal HTML, and JS.
// The only mode-specific part is `collectDeployFiles()` which each mode defines.

/**
 * Returns the CSS for deploy toolbar button, dropdown, modal, and custom select.
 * Inject into the export page's <style> block.
 */
export function getDeployCSS(): string {
  return `
  .deploy-dropdown-wrap {
    position: relative;
  }
  .btn-deploy-trigger {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0 !important;
    border-radius: 999px !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
    background: rgba(255, 255, 255, 0.05) !important;
    color: var(--color-cc-fg);
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .btn-deploy-trigger:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
    color: var(--color-cc-primary);
  }
  .btn-deploy-trigger:disabled {
    opacity: 0.35;
    cursor: not-allowed;
  }
  .deploy-dropdown {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    background: var(--color-cc-surface);
    border: 1px solid var(--color-cc-border);
    border-radius: 12px;
    padding: 6px;
    min-width: 180px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    z-index: 200;
  }
  .deploy-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: var(--color-cc-fg);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
    font-family: inherit;
  }
  .deploy-dropdown-item:hover {
    background: rgba(255, 255, 255, 0.06);
  }

  /* Deploy Modal */
  .deploy-modal {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .deploy-modal-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
  }
  .deploy-modal-content {
    position: relative;
    background: var(--color-cc-surface);
    border: 1px solid var(--color-cc-border);
    border-radius: 16px;
    padding: 28px;
    min-width: 400px;
    max-width: 480px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04) inset;
  }
  .deploy-modal-content h3 {
    margin: 0 0 20px;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-cc-fg);
    letter-spacing: -0.01em;
  }
  .deploy-modal-content label {
    display: block;
    font-size: 11px;
    font-weight: 500;
    color: var(--color-cc-muted);
    margin-bottom: 14px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .deploy-modal-content input {
    display: block;
    width: 100%;
    margin-top: 6px;
    padding: 9px 12px;
    font-size: 13px;
    background: var(--color-cc-bg);
    border: 1px solid var(--color-cc-border) !important;
    border-radius: 10px !important;
    color: var(--color-cc-fg);
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.2s;
    font-family: inherit;
  }
  .deploy-modal-content input:focus {
    border-color: rgba(249, 115, 22, 0.4) !important;
    box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.08);
  }
  .custom-select {
    position: relative;
    margin-top: 6px;
  }
  .custom-select-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 9px 12px !important;
    font-size: 13px !important;
    background: var(--color-cc-bg) !important;
    border: 1px solid var(--color-cc-border) !important;
    border-radius: 10px !important;
    color: var(--color-cc-fg);
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: border-color 0.2s;
  }
  .custom-select-trigger svg {
    color: var(--color-cc-muted);
    flex-shrink: 0;
  }
  .custom-select-trigger:hover {
    border-color: rgba(255, 255, 255, 0.15) !important;
  }
  .custom-select-options {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: var(--color-cc-surface);
    border: 1px solid var(--color-cc-border);
    border-radius: 10px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    max-height: 160px;
    overflow-y: auto;
  }
  .custom-select-option {
    padding: 8px 12px;
    font-size: 13px;
    color: var(--color-cc-fg);
    border-radius: 7px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .custom-select-option:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .custom-select-option.selected {
    color: var(--color-cc-primary);
  }
  .deploy-actions {
    display: flex;
    gap: 8px;
    margin-top: 20px;
    position: relative;
    z-index: 1;
  }
  .deploy-actions button {
    padding: 8px 18px !important;
    border-radius: 10px !important;
    font-size: 13px !important;
    font-weight: 500;
    border: none !important;
  }
  .deploy-actions .btn-primary {
    background: var(--color-cc-primary) !important;
    color: #fff;
    box-shadow: 0 2px 12px rgba(249, 115, 22, 0.25);
  }
  .deploy-actions .btn-primary:hover {
    box-shadow: 0 4px 16px rgba(249, 115, 22, 0.4);
  }
  .deploy-actions .btn-secondary {
    background: rgba(255, 255, 255, 0.06) !important;
    border: 1px solid var(--color-cc-border) !important;
    color: var(--color-cc-muted);
  }
  .deploy-actions .btn-secondary:hover {
    color: var(--color-cc-fg);
    background: rgba(255, 255, 255, 0.1) !important;
  }
  .deploy-progress {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 0;
    color: var(--color-cc-muted);
    font-size: 13px;
  }
  .deploy-spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: var(--color-cc-primary);
    border-radius: 50%;
    animation: deploy-spin 0.7s linear infinite;
    flex-shrink: 0;
  }
  @keyframes deploy-spin { to { transform: rotate(360deg); } }
  .deploy-log {
    margin-top: 12px;
    padding: 10px 12px;
    background: var(--color-cc-bg);
    border: 1px solid var(--color-cc-border);
    border-radius: 10px;
    max-height: 120px;
    overflow-y: auto;
    font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
    font-size: 11px;
    line-height: 1.6;
    color: var(--color-cc-muted);
  }
  .deploy-log .log-line {
    white-space: pre-wrap;
    word-break: break-all;
  }
  .deploy-log .log-line.log-ok { color: #22c55e; }
  .deploy-log .log-line.log-err { color: #ef4444; }
  .deploy-log .log-line.log-info { color: var(--color-cc-primary); }
  .deploy-success {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #22c55e;
    font-size: 13px;
    font-weight: 500;
    margin-bottom: 12px;
  }
  .deploy-success svg { flex-shrink: 0; }
  .deploy-url-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
    padding: 9px 12px;
    background: var(--color-cc-bg);
    border: 1px solid var(--color-cc-border);
    border-radius: 10px;
  }
  .deploy-url-text {
    flex: 1;
    font-family: 'SF Mono', 'Fira Code', monospace;
    font-size: 12px;
    color: var(--color-cc-fg);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .deploy-url-copy {
    flex-shrink: 0;
    padding: 3px 10px !important;
    font-size: 11px !important;
    border-radius: 6px !important;
    background: rgba(255, 255, 255, 0.06) !important;
    border: 1px solid var(--color-cc-border) !important;
    color: var(--color-cc-muted);
    cursor: pointer;
    transition: all 0.15s;
    font-family: inherit;
  }
  .deploy-url-copy:hover {
    color: var(--color-cc-fg);
    background: rgba(255, 255, 255, 0.1) !important;
  }
  .deploy-error-msg {
    color: #ef4444;
    font-size: 12px;
    line-height: 1.5;
    margin-bottom: 14px;
    padding: 10px 12px;
    background: rgba(239, 68, 68, 0.06);
    border: 1px solid rgba(239, 68, 68, 0.15);
    border-radius: 10px;
  }
  #vercel-status-msg {
    font-size: 12px;
    color: var(--color-cc-muted);
    margin-bottom: 14px;
  }`;
}

/**
 * Returns the deploy toolbar button HTML (cloud icon + dropdown).
 * Insert inside .export-toolbar-actions, typically after a .print-divider.
 */
export function getDeployToolbarHTML(): string {
  return `<div class="print-divider"></div>
      <div class="deploy-dropdown-wrap" id="deploy-wrap">
        <button class="btn-deploy-trigger" id="vercel-btn" onclick="toggleDeployMenu()" disabled title="Deploy">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/><path d="M12 13v6"/><path d="m9 17 3-3 3 3"/></svg>
        </button>
        <div class="deploy-dropdown" id="deploy-dropdown" style="display:none">
          <button class="deploy-dropdown-item" onclick="closeDeployMenu();openVercelDeploy()">
            <svg width="14" height="14" viewBox="0 0 76 65" fill="currentColor"><path d="M37.5274 0L75.0548 65H0L37.5274 0Z"/></svg>
            <span id="vercel-label">Vercel</span>
          </button>
        </div>
      </div>`;
}

/**
 * Returns the deploy modal HTML.
 * Insert after the toolbar wrapper, before </body>.
 */
export function getDeployModalHTML(): string {
  return `<div id="vercel-modal" class="deploy-modal" style="display:none">
  <div class="deploy-modal-backdrop" onclick="closeVercelModal()"></div>
  <div class="deploy-modal-content">
    <h3>Deploy to Vercel</h3>
    <div id="vercel-status-msg"></div>
    <div id="vercel-form" style="display:none">
      <label>Project Name<input id="vercel-project-name" type="text" placeholder="my-project" /></label>
      <label>Team
        <div class="custom-select" id="vercel-team-wrap">
          <button type="button" class="custom-select-trigger" id="vercel-team-trigger" onclick="toggleTeamSelect()">
            <span id="vercel-team-label">Personal</span>
            <svg width="10" height="6" viewBox="0 0 10 6" fill="none"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </button>
          <div class="custom-select-options" id="vercel-team-options" style="display:none">
            <div class="custom-select-option selected" data-value="" onclick="selectTeam('','Personal')">Personal</div>
          </div>
          <input type="hidden" id="vercel-team" value="" />
        </div>
      </label>
      <div class="deploy-actions">
        <button class="btn-primary" onclick="executeDeploy()">Deploy</button>
        <button class="btn-secondary" onclick="closeVercelModal()">Cancel</button>
      </div>
    </div>
    <div id="vercel-progress" style="display:none">
      <div class="deploy-progress"><div class="deploy-spinner"></div><span>Deploying...</span></div>
      <div id="deploy-log" class="deploy-log"></div>
    </div>
    <div id="vercel-result" style="display:none">
      <div class="deploy-success"><svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16A8 8 0 108 0a8 8 0 000 16zm3.78-9.72a.75.75 0 00-1.06-1.06L7 8.94 5.28 7.22a.75.75 0 00-1.06 1.06l2.25 2.25a.75.75 0 001.06 0l4.25-4.25z"/></svg> Deployed</div>
      <div class="deploy-url-row">
        <span id="vercel-url" class="deploy-url-text"></span>
        <button class="deploy-url-copy" onclick="navigator.clipboard.writeText(document.getElementById('vercel-url').textContent);this.textContent='Copied';var b=this;setTimeout(function(){b.textContent='Copy'},1500)" title="Copy URL">Copy</button>
      </div>
      <div id="result-log" class="deploy-log"></div>
      <div class="deploy-actions">
        <button class="btn-primary" onclick="window.open(document.getElementById('vercel-url').textContent)" style="border:none">Open Site</button>
        <button class="btn-secondary" id="vercel-console-link" onclick="window.open(this.dataset.href)">Dashboard</button>
        <button class="btn-secondary" onclick="closeVercelModal()">Done</button>
      </div>
    </div>
    <div id="vercel-error" style="display:none">
      <div class="deploy-error-msg" id="deploy-error-text"></div>
      <div id="error-log" class="deploy-log"></div>
      <div class="deploy-actions">
        <button class="btn-secondary" onclick="closeVercelModal()">Close</button>
      </div>
    </div>
  </div>
</div>`;
}

/**
 * Returns the deploy JavaScript.
 * Each mode must define a global `collectDeployFiles()` function that returns
 * Promise<Array<{ path: string; content: string }>> before this script runs.
 *
 * NOTE: Inside template literals in export.ts, `</script>` closings must be
 * escaped as `<\/script>`. This function returns raw JS — the caller must
 * handle escaping if embedding in a <script> block.
 */
export function getDeployScript(): string {
  return `
var _vercelBinding = null;
var _vercelStatus = null;
var _deployContentSet = new URLSearchParams(location.search).get("contentSet") || "";

(function(){
  var bindingQs = _deployContentSet ? "?contentSet=" + encodeURIComponent(_deployContentSet) : "";
  fetch("/api/vercel/status").then(function(r){return r.json()}).then(function(s){
    _vercelStatus = s;
    var btn = document.getElementById("vercel-btn");
    if(s.available) btn.disabled = false;
    return fetch("/api/vercel/binding" + bindingQs).then(function(r){return r.json()});
  }).then(function(b){
    if(b && b.projectId) {
      _vercelBinding = b;
      document.getElementById("vercel-label").textContent = "Update: " + b.projectName;
    }
  }).catch(function(){});
})();

function toggleDeployMenu(){
  var dd = document.getElementById("deploy-dropdown");
  dd.style.display = dd.style.display === "none" ? "block" : "none";
}
function closeDeployMenu(){
  document.getElementById("deploy-dropdown").style.display = "none";
}
document.addEventListener("click", function(e){
  var wrap = document.getElementById("deploy-wrap");
  if(wrap && !wrap.contains(e.target)) closeDeployMenu();
  var teamWrap = document.getElementById("vercel-team-wrap");
  if(teamWrap && !teamWrap.contains(e.target)) {
    document.getElementById("vercel-team-options").style.display = "none";
  }
});

function openVercelDeploy(){
  var modal = document.getElementById("vercel-modal");
  modal.style.display = "flex";
  ["vercel-form","vercel-progress","vercel-result","vercel-error"].forEach(function(id){
    document.getElementById(id).style.display="none";
  });

  document.getElementById("vercel-form").style.display = "block";

  var nameInput = document.getElementById("vercel-project-name");
  if(_vercelBinding) {
    nameInput.value = _vercelBinding.projectName;
    document.getElementById("vercel-status-msg").innerHTML = 'Linked to <a href="https://vercel.com/' + _vercelBinding.projectName + '" target="_blank" style="color:var(--color-cc-primary);text-decoration:none">' + _vercelBinding.projectName + '</a>';
  } else {
    document.getElementById("vercel-status-msg").textContent = "";
    if(!nameInput.value) {
      nameInput.value = document.title.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "pneuma-project";
    }
  }

  if(_vercelStatus && _vercelStatus.method === "token") {
    fetch("/api/vercel/teams").then(function(r){return r.json()}).then(function(data){
      var optionsEl = document.getElementById("vercel-team-options");
      if(optionsEl.children.length <= 1) {
        (data.teams||[]).forEach(function(t){
          var div = document.createElement("div");
          div.className = "custom-select-option";
          div.setAttribute("data-value", t.id);
          div.textContent = t.name;
          div.onclick = function(){ selectTeam(t.id, t.name); };
          optionsEl.appendChild(div);
        });
      }
      if(_vercelBinding && _vercelBinding.teamId) {
        selectTeam(_vercelBinding.teamId, _vercelBinding.teamId);
      }
    }).catch(function(){});
  }
}

function toggleTeamSelect(){
  var opts = document.getElementById("vercel-team-options");
  opts.style.display = opts.style.display === "none" ? "block" : "none";
}

function selectTeam(val, label){
  document.getElementById("vercel-team").value = val;
  document.getElementById("vercel-team-label").textContent = label;
  document.getElementById("vercel-team-options").style.display = "none";
  var items = document.querySelectorAll("#vercel-team-options .custom-select-option");
  items.forEach(function(it){ it.classList.toggle("selected", it.getAttribute("data-value") === val); });
}

function closeVercelModal(){
  document.getElementById("vercel-modal").style.display = "none";
}

function deployLog(logEl, msg, cls){
  var line = document.createElement("div");
  line.className = "log-line" + (cls ? " log-" + cls : "");
  line.textContent = msg;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function executeDeploy(){
  document.getElementById("vercel-form").style.display = "none";
  document.getElementById("vercel-progress").style.display = "block";
  document.getElementById("vercel-status-msg").textContent = "";
  var logEl = document.getElementById("deploy-log");
  logEl.innerHTML = "";

  // collectDeployFiles() must be defined by each mode.
  // Returns Promise<Array<{ path: string, content: string }>>
  collectDeployFiles(logEl).then(function(files){
    deployLog(logEl, "Total: " + files.length + " files");

    var body = { files: files, framework: null, contentSet: _deployContentSet || undefined };

    if(_vercelBinding) {
      body.projectId = _vercelBinding.projectId;
      body.projectName = _vercelBinding.projectName;
      body.orgId = _vercelBinding.orgId || null;
      body.teamId = _vercelBinding.teamId;
      deployLog(logEl, "Updating project: " + _vercelBinding.projectName, "info");
    } else {
      body.projectName = document.getElementById("vercel-project-name").value;
      var teamSel = document.getElementById("vercel-team");
      body.teamId = teamSel.value || null;
      deployLog(logEl, "Creating project: " + body.projectName, "info");
    }

    deployLog(logEl, "Uploading to Vercel...", "info");

    return fetch("/api/vercel/deploy", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(function(r){ return r.json(); });
  }).then(function(result){
    if(result.error) throw new Error(result.error);

    deployLog(logEl, "Deployed!", "ok");
    deployLog(logEl, result.url, "ok");

    var pName = document.getElementById("vercel-project-name")?.value || _vercelBinding?.projectName || "pneuma-deploy";
    _vercelBinding = {
      projectId: result.projectId,
      orgId: result.orgId || _vercelBinding?.orgId || null,
      projectName: pName,
      url: result.url,
    };

    document.getElementById("vercel-label").textContent = "Update: " + pName;
    document.getElementById("vercel-console-link").dataset.href = result.dashboardUrl || "https://vercel.com";

    document.getElementById("result-log").innerHTML = logEl.innerHTML;
    document.getElementById("vercel-progress").style.display = "none";
    document.getElementById("vercel-result").style.display = "block";
    document.getElementById("vercel-url").textContent = result.url;
  }).catch(function(err){
    deployLog(logEl, "Failed: " + err.message, "err");
    document.getElementById("error-log").innerHTML = logEl.innerHTML;
    document.getElementById("vercel-progress").style.display = "none";
    document.getElementById("vercel-error").style.display = "block";
    document.getElementById("deploy-error-text").textContent = err.message;
  });
}`;
}
