const path = require('path');
const fs = require('fs');

const isElectron = process.versions.hasOwnProperty('electron');
let baseDataDir;
let configPath;

if (isElectron) {
  const { app } = require('electron');
  const userDataPath = app.getPath('userData');
  configPath = path.join(userDataPath, 'app_config.json');
} else {
  configPath = path.join(__dirname, '..', '..', 'data', 'app_config.json');
}

const getAppConfig = () => {
  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (e) {}
  }
  return {};
};

const setAppConfig = (newConfig) => {
  const config = { ...getAppConfig(), ...newConfig };
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
};

const config = getAppConfig();
if (config.customDataDir && fs.existsSync(config.customDataDir)) {
  baseDataDir = config.customDataDir;
}

if (!baseDataDir) {
  if (isElectron) {
    const { app } = require('electron');
    baseDataDir = path.join(app.getPath('userData'), 'data');
  } else {
    baseDataDir = path.join(__dirname, '..', '..', 'data');
  }
}

const setCustomDataDir = (newDir) => {
  if (!isElectron) return;
  setAppConfig({ customDataDir: newDir });
};

module.exports = {
  baseDataDir,
  setCustomDataDir,
  getAppConfig,
  setAppConfig
};
