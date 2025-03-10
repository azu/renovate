const { logger } = require('../../logger');

module.exports = {
  extractPackageFile,
};

function extractPackageFile(content) {
  let deps = [];
  const npmDepends = content.match(/\nNpm\.depends\({([\s\S]*?)}\);/);
  if (!npmDepends) {
    return null;
  }
  try {
    deps = npmDepends[1]
      .replace(/(\s|\\n|\\t|'|")/g, '')
      .split(',')
      .map(dep => dep.trim())
      .filter(dep => dep.length)
      .map(dep => dep.split(/:(.*)/))
      .map(arr => {
        const [depName, currentValue] = arr;
        // istanbul ignore if
        if (!(depName && currentValue)) {
          logger.warn({ content }, 'Incomplete npm.depends match');
        }
        return {
          depName,
          currentValue,
          datasource: 'npm',
        };
      })
      .filter(dep => dep.depName && dep.currentValue);
  } catch (err) /* istanbul ignore next */ {
    logger.warn({ content }, 'Failed to parse meteor package.js');
  }
  // istanbul ignore if
  if (!deps.length) {
    return null;
  }
  return { deps };
}
