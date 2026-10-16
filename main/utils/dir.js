const path = require('path');
const fs = require('fs');

const isElectron = process.versions.hasOwnProperty('electron');
const electronApp = isElectron ? require('electron').app : null;
let baseDataDir;
let configPath;

if (isElectron) {
  const userDataPath = electronApp.getPath('userData');
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
if (config.customDataDir) {
  baseDataDir = config.customDataDir;
}

const getDefaultDataDir = () => {
  if (!isElectron || !electronApp.isPackaged) {
    return path.join(__dirname, '..', '..', 'data');
  }
  return path.join(path.dirname(process.execPath), 'data');
};

if (!baseDataDir) {
  baseDataDir = getDefaultDataDir();
}

fs.mkdirSync(baseDataDir, { recursive: true });

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
