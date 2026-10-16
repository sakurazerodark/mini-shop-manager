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
if (config.customDataDir && fs.existsSync(config.customDataDir)) {
  baseDataDir = config.customDataDir;
}

const canUseDataDir = (dir) => {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, '');
    fs.unlinkSync(probe);
    return true;
  } catch (e) {
    return false;
  }
};

const getDefaultDataDir = () => {
  if (!isElectron || !electronApp.isPackaged) {
    return path.join(__dirname, '..', '..', 'data');
  }
  return path.join(path.dirname(process.execPath), 'data');
};

const migrateLegacyDataDir = (preferredDir) => {
  if (!isElectron || !electronApp.isPackaged) return preferredDir;

  const legacyDir = path.join(electronApp.getPath('userData'), 'data');
  const legacyDb = path.join(legacyDir, 'shop.db');
  const preferredDb = path.join(preferredDir, 'shop.db');
  if (!fs.existsSync(legacyDb) || fs.existsSync(preferredDb)) return preferredDir;

  try {
    fs.cpSync(legacyDir, preferredDir, { recursive: true, force: true });
    return preferredDir;
  } catch (e) {
    // A protected installation directory should not prevent the app from
    // opening existing data. The user can still choose another directory.
    return legacyDir;
  }
};

const getLegacyDataDir = () => {
  if (!isElectron || !electronApp.isPackaged) return null;
  return path.join(electronApp.getPath('userData'), 'data');
};

// Keep a copy outside the install directory so uninstall/reinstall can restore
// the current database and uploaded files. The install directory remains the
// active location; this copy is only a recovery source.
const syncLegacyDataDir = (activeDir = baseDataDir) => {
  const legacyDir = getLegacyDataDir();
  const defaultDir = getDefaultDataDir();
  if (!legacyDir || !activeDir || path.resolve(activeDir) !== path.resolve(defaultDir)) return false;

  const activeDb = path.join(activeDir, 'shop.db');
  if (!fs.existsSync(activeDb)) return false;

  const legacyDb = path.join(legacyDir, 'shop.db');
  try {
    const activeStat = fs.statSync(activeDb);
    const legacyStat = fs.existsSync(legacyDb) ? fs.statSync(legacyDb) : null;
    if (legacyStat && legacyStat.mtimeMs >= activeStat.mtimeMs) return false;
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.cpSync(activeDir, legacyDir, { recursive: true, force: true });
    return true;
  } catch (e) {
    return false;
  }
};

if (!baseDataDir) {
  const preferredDir = migrateLegacyDataDir(getDefaultDataDir());
  baseDataDir = canUseDataDir(preferredDir)
    ? preferredDir
    : (isElectron ? path.join(electronApp.getPath('userData'), 'data') : preferredDir);
}

const setCustomDataDir = (newDir) => {
  if (!isElectron) return;
  setAppConfig({ customDataDir: newDir });
};

module.exports = {
  baseDataDir,
  setCustomDataDir,
  getAppConfig,
  setAppConfig,
  getLegacyDataDir,
  syncLegacyDataDir
};
