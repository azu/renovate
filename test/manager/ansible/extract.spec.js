const fs = require('fs');
const { extractPackageFile } = require('../../../lib/manager/ansible/extract');

const yamlFile1 = fs.readFileSync(
  'test/manager/ansible/_fixtures/main1.yaml',
  'utf8'
);
const yamlFile2 = fs.readFileSync(
  'test/manager/ansible/_fixtures/main2.yaml',
  'utf8'
);

describe('lib/manager/ansible/extract', () => {
  describe('extractPackageFile()', () => {
    it('returns null for empty', () => {
      expect(extractPackageFile('nothing here')).toBeNull();
    });
    it('extracts multiple image lines from docker_container', () => {
      const res = extractPackageFile(yamlFile1);
      expect(res.deps).toMatchSnapshot();
      expect(res.deps).toHaveLength(9);
    });
    it('extracts multiple image lines from docker_service', () => {
      const res = extractPackageFile(yamlFile2);
      expect(res.deps).toMatchSnapshot();
      expect(res.deps).toHaveLength(4);
    });
  });
});
