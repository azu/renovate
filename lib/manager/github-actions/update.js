const { logger } = require('../../logger');
const { getNewFrom } = require('../dockerfile/update');

module.exports = {
  updateDependency,
};

function updateDependency(fileContent, upgrade) {
  try {
    const newFrom = getNewFrom(upgrade);
    logger.debug(`github-actions.updateDependency(): ${newFrom}`);
    const lines = fileContent.split('\n');
    const lineToChange = lines[upgrade.lineNumber];
    const imageLine = new RegExp(/^(\s+uses = "docker:\/\/)[^"]+("\s*)$/);
    if (!lineToChange.match(imageLine)) {
      logger.debug('No image line found');
      return null;
    }
    const newLine = lineToChange.replace(imageLine, `$1${newFrom}$2`);
    if (newLine === lineToChange) {
      logger.debug('No changes necessary');
      return fileContent;
    }
    lines[upgrade.lineNumber] = newLine;
    return lines.join('\n');
  } catch (err) {
    logger.info({ err }, 'Error setting new github-actions value');
    return null;
  }
}
