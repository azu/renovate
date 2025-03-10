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
      const imageMatch = line.match(/^\s*image:\s*'?"?([^\s]+|)'?"?\s*$/);
      if (imageMatch) {
        switch (imageMatch[1]) {
          case '': {
            const imageNameLine = lines[lineNumber + 1];
            const imageNameMatch = imageNameLine.match(
              /^\s*name:\s*'?"?([^\s]+|)'?"?\s*$/
            );

            if (imageNameMatch) {
              lineNumber += 1;
              logger.trace(`Matched image name on line ${lineNumber}`);
              const currentFrom = imageNameMatch[1];
              /** @type any */
              const dep = getDep(currentFrom);
              dep.lineNumber = lineNumber;
              dep.depType = 'image-name';
              deps.push(dep);
            }
            break;
          }
          default: {
            logger.trace(`Matched image on line ${lineNumber}`);
            const currentFrom = imageMatch[1];
            /** @type any */
            const dep = getDep(currentFrom);
            dep.lineNumber = lineNumber;
            dep.depType = 'image';
            deps.push(dep);
          }
        }
      }
      const services = line.match(/^\s*services:\s*$/);
      if (services) {
        logger.trace(`Matched services on line ${lineNumber}`);
        let foundImage;
        do {
          foundImage = false;
          const serviceImageLine = lines[lineNumber + 1];
          logger.trace(`serviceImageLine: "${serviceImageLine}"`);
          const serviceImageMatch = serviceImageLine.match(
            /^\s*-\s*'?"?([^\s'"]+)'?"?\s*$/
          );
          if (serviceImageMatch) {
            logger.trace('serviceImageMatch');
            foundImage = true;
            const currentFrom = serviceImageMatch[1];
            lineNumber += 1;
            /** @type any */
            const dep = getDep(currentFrom);
            dep.lineNumber = lineNumber;
            dep.depType = 'service-image';
            deps.push(dep);
          }
        } while (foundImage);
      }
    }
  } catch (err) /* istanbul ignore next */ {
    logger.warn({ err }, 'Error extracting GitLab CI dependencies');
  }
  if (!deps.length) {
    return null;
  }
  return { deps };
}
