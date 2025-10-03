const { spawn } = require('node:child_process');

function runBundle() {
  const npmCommand = 'npm';
  const useShell = process.platform === 'win32';

  return new Promise((resolve, reject) => {
    const child = spawn(npmCommand, ['run', 'build'], {
      stdio: 'inherit',
      shell: useShell,
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve(true);
      } else {
        reject(new Error(`npm run build exited with code ${code}`));
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

module.exports = {
  appId: 'com.pseudo.zoom.secretary',
  directories: {
    output: 'release',
  },
  files: ['dist/**/*', 'py/**/*', 'package.json'],
  extraResources: [
    {
      from: 'py',
      to: 'py',
    },
  ],
  async beforeBuild() {
    await runBundle();
    return true;
  },
};
