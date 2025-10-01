const { spawn } = require('child_process');

function runBuildTs() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', 'build:ts'], {
      stdio: 'inherit',
      shell: false,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`npm run build:ts exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

module.exports = {
  appId: 'com.pseudo.zoom.secretary',
  files: [
    'dist/**/*',
    'py/**/*',
    'package.json',
  ],
  extraResources: [
    {
      from: 'py',
      to: 'py',
    },
  ],
  async beforeBuild() {
    await runBuildTs();
    return true;
  },
};
