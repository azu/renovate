import is from '@sindresorhus/is';

const URL = require('url');
const { exec } = require('child-process-promise');
const fs = require('fs-extra');
const upath = require('upath');
const { logger } = require('../../logger');
const hostRules = require('../../util/host-rules');
const { getChildProcessEnv } = require('../../util/env');

export { updateArtifacts };

async function updateArtifacts(
  packageFileName,
  updatedDeps,
  newPackageFileContent,
  config
) {
  logger.debug(`composer.updateArtifacts(${packageFileName})`);
  process.env.COMPOSER_CACHE_DIR =
    process.env.COMPOSER_CACHE_DIR ||
    upath.join(config.cacheDir, './others/composer');
  await fs.ensureDir(process.env.COMPOSER_CACHE_DIR);
  logger.debug('Using composer cache ' + process.env.COMPOSER_CACHE_DIR);
  const lockFileName = packageFileName.replace(/\.json$/, '.lock');
  const existingLockFileContent = await platform.getFile(lockFileName);
  if (!existingLockFileContent) {
    logger.debug('No composer.lock found');
    return null;
  }
  const cwd = upath.join(config.localDir, upath.dirname(packageFileName));
  await fs.ensureDir(upath.join(cwd, 'vendor'));
  let stdout;
  let stderr;
  try {
    const localPackageFileName = upath.join(config.localDir, packageFileName);
    await fs.outputFile(localPackageFileName, newPackageFileContent);
    const localLockFileName = upath.join(config.localDir, lockFileName);
    if (config.isLockFileMaintenance) {
      await fs.remove(localLockFileName);
    }
    const authJson = {};
    let credentials = hostRules.find({
      hostType: 'github',
      url: 'https://api.github.com/',
    });
    // istanbul ignore if
    if (credentials && credentials.token) {
      authJson['github-oauth'] = {
        'github.com': credentials.token,
      };
    }
    credentials = hostRules.find({
      hostType: 'gitlab',
      url: 'https://gitlab.com/api/v4/',
    });
    // istanbul ignore if
    if (credentials && credentials.token) {
      authJson['gitlab-token'] = {
        'gitlab.com': credentials.token,
      };
    }
    try {
      // istanbul ignore else
      if (is.array(config.registryUrls)) {
        for (const regUrl of config.registryUrls) {
          if (regUrl.url) {
            const { host } = URL.parse(regUrl.url);
            const hostRule = hostRules.find({
              hostType: 'packagist',
              url: regUrl.url,
            });
            // istanbul ignore else
            if (hostRule.username && hostRule.password) {
              logger.debug('Setting packagist auth for host ' + host);
              authJson['http-basic'] = authJson['http-basic'] || {};
              authJson['http-basic'][host] = {
                username: hostRule.username,
                password: hostRule.password,
              };
            } else {
              logger.debug('No packagist auth found for ' + regUrl.url);
            }
          }
        }
      } else if (config.registryUrls) {
        logger.warn(
          { registryUrls: config.registryUrls },
          'Non-array composer registryUrls'
        );
      }
    } catch (err) /* istanbul ignore next */ {
      logger.warn({ err }, 'Error setting registryUrls auth for composer');
    }
    if (authJson) {
      const localAuthFileName = upath.join(cwd, 'auth.json');
      await fs.outputFile(localAuthFileName, JSON.stringify(authJson));
    }
    const env = getChildProcessEnv(['COMPOSER_CACHE_DIR']);
    const startTime = process.hrtime();
    let cmd;
    if (config.binarySource === 'docker') {
      logger.info('Running composer via docker');
      cmd = `docker run --rm `;
      const volumes = [config.localDir, process.env.COMPOSER_CACHE_DIR];
      cmd += volumes.map(v => `-v ${v}:${v} `).join('');
      const envVars = ['COMPOSER_CACHE_DIR'];
      cmd += envVars.map(e => `-e ${e} `);
      cmd += `-w ${cwd} `;
      cmd += `renovate/composer composer`;
    } else {
      logger.info('Running composer via global composer');
      cmd = 'composer';
    }
    let args;
    if (config.isLockFileMaintenance) {
      args = 'install';
    } else {
      args =
        ('update ' + updatedDeps.join(' ')).trim() + ' --with-dependencies';
    }
    args +=
      ' --ignore-platform-reqs --no-ansi --no-interaction --no-scripts --no-autoloader';
    logger.debug({ cmd, args }, 'composer command');
    ({ stdout, stderr } = await exec(`${cmd} ${args}`, {
      cwd,
      shell: true,
      env,
    }));
    const duration = process.hrtime(startTime);
    const seconds = Math.round(duration[0] + duration[1] / 1e9);
    logger.info(
      { seconds, type: 'composer.lock', stdout, stderr },
      'Generated lockfile'
    );
    const status = await platform.getRepoStatus();
    if (!status.modified.includes(lockFileName)) {
      return null;
    }
    logger.debug('Returning updated composer.lock');
    return [
      {
        file: {
          name: lockFileName,
          contents: await fs.readFile(localLockFileName, 'utf8'),
        },
      },
    ];
  } catch (err) {
    if (
      err.message &&
      err.message.includes(
        'Your requirements could not be resolved to an installable set of packages.'
      )
    ) {
      logger.info('Composer requirements cannot be resolved');
    } else if (
      err.message &&
      err.message.includes('write error (disk full?)')
    ) {
      throw new Error('disk-space');
    } else {
      logger.debug({ err }, 'Failed to generate composer.lock');
    }
    return [
      {
        artifactError: {
          lockFile: lockFileName,
          stderr: err.message,
        },
      },
    ];
  }
}
