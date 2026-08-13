import { getSavedApiConfig, saveApiConfig } from './api.js';

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
