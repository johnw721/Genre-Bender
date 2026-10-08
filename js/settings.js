import { getSavedApiConfig, saveApiConfig } from './api.js';
import { exportAll, importAll, downloadJSON, registeredStores } from './storage.js';
import { registerActions } from './actions.js';

const $ = (id) => document.getElementById(id);

export function openSettings(){
  const modal = $('settings-modal');
  if (!modal) return;
  loadSettingsForm();
  modal.style.display = 'flex';
  document.body.classList.add('modal-open');
}

export function closeSettings(){
  const modal = $('settings-modal');
  if (!modal) return;
  modal.style.display = 'none';
  document.body.classList.remove('modal-open');
}

export function loadSettingsForm(){
  const config = getSavedApiConfig();
  const endpoint = $('settings-endpoint');
  const model = $('settings-model');
  const apiKey = $('settings-api-key');
  const status = $('settings-status');
  if (endpoint) endpoint.value = config.endpoint || '';
  if (model) model.value = config.model || '';
  if (apiKey) apiKey.value = config.apiKey || '';
  if (status) status.textContent = '';
}

export function saveSettings(){
  const endpoint = $('settings-endpoint')?.value.trim();
  const model = $('settings-model')?.value.trim();
  const apiKey = $('settings-api-key')?.value.trim();
  saveApiConfig({ endpoint, model, apiKey });
  const status = $('settings-status');
  if (status) status.textContent = 'AI settings saved locally.';
  setTimeout(() => {
    if (status) status.textContent = '';
  }, 2500);
  closeSettings();
}

/* ---- whole-app backup ------------------------------------------------------
   Everything registered in storage.js (session, clips, trainer progress,
   label prefs) in one JSON file. API credentials are never included. */
export function backupExport(){
  downloadJSON(exportAll(), `genre-bender-backup-${new Date().toISOString().slice(0, 10)}.json`);
  const status = $('settings-status');
  if (status) status.textContent = `Backup written (${registeredStores().length} stores).`;
}

export function backupImportFile(inputEl){
  const file = inputEl?.files?.[0];
  if (!file) return;
  const status = $('settings-status');
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const written = importAll(JSON.parse(reader.result));
      if (status) status.textContent = `Restored ${written.length} store${written.length === 1 ? '' : 's'} — reloading…`;
      setTimeout(() => location.reload(), 600);
    } catch (e) {
      if (status) status.textContent = e.message || 'Could not read that backup.';
    }
    inputEl.value = '';
  };
  reader.readAsText(file);
}

registerActions({
  'settings:open':  () => openSettings(),
  'settings:close': () => closeSettings(),
  'settings:save':  () => saveSettings(),
  'backup:export':  () => backupExport(),
  'backup:import':  (el) => backupImportFile(el),
});
