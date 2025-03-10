const fs = require('fs-extra');
const path = require('path');
const upath = require('upath');
const validateNpmPackageName = require('validate-npm-package-name');
const { logger } = require('../../../logger');

const { getLockedVersions } = require('./locked-versions');
const { detectMonorepos } = require('./monorepo');
const { mightBeABrowserLibrary } = require('./type');
const semver = require('../../../versioning/npm');

module.exports = {
  extractAllPackageFiles,
  extractPackageFile,
  postExtract,
};

async function extractAllPackageFiles(config, packageFiles) {
  const npmFiles = [];
  for (const packageFile of packageFiles) {
    const content = await platform.getFile(packageFile);
    if (content) {
      const deps = await extractPackageFile(content, packageFile, config);
      if (deps) {
        npmFiles.push({
          packageFile,
          manager: 'npm',
          ...deps,
        });
      }
    } else {
      logger.info({ packageFile }, 'packageFile has no content');
    }
  }
  await postExtract(npmFiles);
  return npmFiles;
}

async function extractPackageFile(content, fileName, config) {
  logger.trace(`npm.extractPackageFile(${fileName})`);
  logger.trace({ content });
  const deps = [];
  let packageJson;
  try {
    packageJson = JSON.parse(content);
  } catch (err) {
    logger.info({ fileName }, 'Invalid JSON');
    return null;
  }
  // eslint-disable-next-line no-underscore-dangle
  if (packageJson._id && packageJson._args && packageJson._from) {
    logger.info('Ignoring vendorised package.json');
    return null;
  }
  if (fileName !== 'package.json' && packageJson.renovate) {
    const error = new Error('config-validation');
    error.configFile = fileName;
    error.validationError =
      'Nested package.json must not contain renovate configuration. Please use `packageRules` with `paths` in your main config instead.';
    throw error;
  }
  const packageJsonName = packageJson.name;
  logger.debug(
    `npm file ${fileName} has name ${JSON.stringify(packageJsonName)}`
  );
  const packageJsonVersion = packageJson.version;
  let yarnWorkspacesPackages;
  if (packageJson.workspaces && packageJson.workspaces.packages) {
    yarnWorkspacesPackages = packageJson.workspaces.packages;
  } else {
    yarnWorkspacesPackages = packageJson.workspaces;
  }
  const packageJsonType = mightBeABrowserLibrary(packageJson)
    ? 'library'
    : 'app';

  const lockFiles = {
    yarnLock: 'yarn.lock',
    packageLock: 'package-lock.json',
    shrinkwrapJson: 'npm-shrinkwrap.json',
    pnpmShrinkwrap: 'pnpm-lock.yaml',
  };

  for (const [key, val] of Object.entries(lockFiles)) {
    const filePath = upath.join(path.dirname(fileName), val);
    if (await platform.getFile(filePath)) {
      lockFiles[key] = filePath;
    } else {
      lockFiles[key] = undefined;
    }
  }
  lockFiles.npmLock = lockFiles.packageLock || lockFiles.shrinkwrapJson;
  delete lockFiles.packageLock;
  delete lockFiles.shrinkwrapJson;

  let npmrc;
  let ignoreNpmrcFile;
  const npmrcFileName = upath.join(path.dirname(fileName), '.npmrc');
  const npmrcFileNameLocal = upath.join(config.localDir || '', npmrcFileName);
  // istanbul ignore if
  if (config.ignoreNpmrcFile) {
    await fs.remove(npmrcFileNameLocal);
  } else {
    npmrc = await platform.getFile(npmrcFileName);
    if (npmrc && npmrc.includes('package-lock')) {
      logger.info('Stripping package-lock setting from npmrc');
      npmrc = npmrc.replace(/(^|\n)package-lock.*?(\n|$)/g, '\n');
    }
    if (npmrc) {
      if (npmrc.includes('=${') && !(global.trustLevel === 'high')) {
        logger.info('Discarding .npmrc file with variables');
        ignoreNpmrcFile = true;
        npmrc = undefined;
        await fs.remove(npmrcFileNameLocal);
      }
    } else {
      npmrc = undefined;
    }
  }
  const yarnrc =
    (await platform.getFile(upath.join(path.dirname(fileName), '.yarnrc'))) ||
    undefined;

  let lernaDir;
  let lernaPackages;
  let lernaClient;
  let hasFileRefs = false;
  const lernaJson = JSON.parse(
    await platform.getFile(upath.join(path.dirname(fileName), 'lerna.json'))
  );
  if (lernaJson) {
    lernaDir = path.dirname(fileName);
    lernaPackages = lernaJson.packages;
    lernaClient = lernaJson.npmClient || lockFiles.yarnLock ? 'yarn' : 'npm';
  }

  const depTypes = {
    dependencies: 'dependency',
    devDependencies: 'devDependency',
    optionalDependencies: 'optionalDependency',
    peerDependencies: 'peerDependency',
    engines: 'engine',
  };

  function extractDependency(depType, depName, input) {
    const dep = {};
    if (!validateNpmPackageName(depName).validForOldPackages) {
      dep.skipReason = 'invalid-name';
      return dep;
    }
    if (typeof input !== 'string') {
      dep.skipReason = 'invalid-value';
      return dep;
    }
    dep.currentValue = input.trim();
    if (depType === 'engines') {
      if (depName === 'node') {
        dep.datasource = 'github';
        dep.lookupName = 'nodejs/node';
        dep.versionScheme = 'node';
      } else if (depName === 'yarn') {
        dep.datasource = 'npm';
        dep.commitMessageTopic = 'Yarn';
      } else if (depName === 'npm') {
        dep.datasource = 'npm';
        dep.commitMessageTopic = 'npm';
      } else {
        dep.skipReason = 'unknown-engines';
      }
      if (!semver.isValid(dep.currentValue)) {
        dep.skipReason = 'unknown-version';
      }
      return dep;
    }
    if (dep.currentValue.startsWith('npm:')) {
      dep.npmPackageAlias = true;
      const valSplit = dep.currentValue.replace('npm:', '').split('@');
      if (valSplit.length === 2) {
        dep.lookupName = valSplit[0];
        dep.currentValue = valSplit[1];
      } else if (valSplit.length === 3) {
        dep.lookupName = valSplit[0] + '@' + valSplit[1];
        dep.currentValue = valSplit[2];
      } else {
        logger.info('Invalid npm package alias: ' + dep.currentValue);
      }
    }
    if (dep.currentValue.startsWith('file:')) {
      dep.skipReason = 'file';
      hasFileRefs = true;
      return dep;
    }
    if (semver.isValid(dep.currentValue)) {
      dep.datasource = 'npm';
      if (dep.currentValue === '*') {
        dep.skipReason = 'any-version';
      }
      if (dep.currentValue === '') {
        dep.skipReason = 'empty';
      }
      return dep;
    }
    const hashSplit = dep.currentValue.split('#');
    if (hashSplit.length !== 2) {
      dep.skipReason = 'unknown-version';
      return dep;
    }
    const [depNamePart, depRefPart] = hashSplit;
    const githubOwnerRepo = depNamePart
      .replace(/^github:/, '')
      .replace(/^git\+/, '')
      .replace(/^https:\/\/github\.com\//, '')
      .replace(/\.git$/, '');
    const githubRepoSplit = githubOwnerRepo.split('/');
    if (githubRepoSplit.length !== 2) {
      dep.skipReason = 'unknown-version';
      return dep;
    }
    const [githubOwner, githubRepo] = githubRepoSplit;
    const githubValidRegex = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/;
    if (
      !githubOwner.match(githubValidRegex) ||
      !githubRepo.match(githubValidRegex)
    ) {
      dep.skipReason = 'unknown-version';
      return dep;
    }
    if (semver.isVersion(depRefPart)) {
      dep.currentRawValue = dep.currentValue;
      dep.currentValue = depRefPart;
      dep.datasource = 'github';
      dep.lookupName = githubOwnerRepo;
      dep.pinDigests = false;
    } else if (
      depRefPart.match(/^[0-9a-f]{7}$/) ||
      depRefPart.match(/^[0-9a-f]{40}$/)
    ) {
      dep.currentRawValue = dep.currentValue;
      dep.currentValue = null;
      dep.currentDigest = depRefPart;
      dep.datasource = 'github';
      dep.lookupName = githubOwnerRepo;
    } else {
      dep.skipReason = 'unversioned-reference';
      return dep;
    }
    dep.githubRepo = githubOwnerRepo;
    dep.sourceUrl = `https://github.com/${githubOwnerRepo}`;
    dep.gitRef = true;
    return dep;
  }

  for (const depType of Object.keys(depTypes)) {
    if (packageJson[depType]) {
      try {
        for (const [depName, val] of Object.entries(packageJson[depType])) {
          const dep = {
            depType,
            depName,
          };
          Object.assign(dep, extractDependency(depType, depName, val));
          if (depName === 'node') {
            // This is a special case for Node.js to group it together with other managers
            dep.commitMessageTopic = 'Node.js';
            dep.major = { enabled: false };
          }
          dep.prettyDepType = depTypes[depType];
          deps.push(dep);
        }
      } catch (err) /* istanbul ignore next */ {
        logger.info({ fileName, depType, err }, 'Error parsing package.json');
        return null;
      }
    }
  }
  if (deps.length === 0) {
    logger.debug('Package file has no deps');
    if (
      !(
        packageJsonName ||
        packageJsonVersion ||
        npmrc ||
        lernaDir ||
        yarnWorkspacesPackages
      )
    ) {
      logger.debug('Skipping file');
      return null;
    }
  }
  let skipInstalls = config.skipInstalls;
  if (skipInstalls === null) {
    if (hasFileRefs) {
      // https://npm.community/t/npm-i-package-lock-only-changes-lock-file-incorrectly-when-file-references-used-in-dependencies/1412
      // Explanation:
      //  - npm install --package-lock-only is buggy for transitive deps in file: references
      //  - So we set skipInstalls to false if file: refs are found *and* the user hasn't explicitly set the value already
      logger.info('Automatically setting skipInstalls to false');
      skipInstalls = false;
    } else {
      skipInstalls = true;
    }
  }
  return {
    deps,
    packageJsonName,
    packageJsonVersion,
    packageJsonType,
    npmrc,
    ignoreNpmrcFile,
    yarnrc,
    ...lockFiles,
    lernaDir,
    lernaClient,
    lernaPackages,
    skipInstalls,
    yarnWorkspacesPackages,
  };
}

async function postExtract(packageFiles) {
  await detectMonorepos(packageFiles);
  await getLockedVersions(packageFiles);
}
