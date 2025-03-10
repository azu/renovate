const { logger } = require('../../logger');
const { getDep } = require('../dockerfile/extract');

module.exports = {
  extractPackageFile,
};

function extractPackageFile(content) {
  const deps = [];
  try {
    const lines = content.split('\n');
    for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
      const line = lines[lineNumber];
      const orbs = line.match(/^\s*orbs:\s*$/);
      if (orbs) {
        logger.trace(`Matched orbs on line ${lineNumber}`);
        let foundOrb;
        do {
          foundOrb = false;
          const orbLine = lines[lineNumber + 1];
          logger.trace(`orbLine: "${orbLine}"`);
          const orbMatch = orbLine.match(/^\s+([^:]+):\s(.+)$/);
          if (orbMatch) {
            logger.trace('orbMatch');
            foundOrb = true;
            lineNumber += 1;
            const depName = orbMatch[1];
            const [orbName, currentValue] = orbMatch[2].split('@');
            const dep = {
              depType: 'orb',
              depName,
              currentValue,
              lineNumber,
              datasource: 'orb',
              lookupName: orbName,
              commitMessageTopic: '{{{depName}}} orb',
              versionScheme: 'npm',
              rangeStrategy: 'pin',
            };
            deps.push(dep);
          }
        } while (foundOrb);
      }
      const match = line.match(/^\s*- image:\s*'?"?([^\s'"]+)'?"?\s*$/);
      if (match) {
        const currentFrom = match[1];
        const dep = getDep(currentFrom);
        logger.debug(
          {
            depName: dep.depName,
            currentValue: dep.currentValue,
            currentDigest: dep.currentDigest,
          },
          'CircleCI docker image'
        );
        dep.depType = 'docker';
        dep.lineNumber = lineNumber;
        deps.push(dep);
      }
    }
  } catch (err) /* istanbul ignore next */ {
    logger.warn({ err }, 'Error extracting circleci images');
  }
  if (!deps.length) {
    return null;
  }
  return { deps };
}
