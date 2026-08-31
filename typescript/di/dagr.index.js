const DI_COMMIT = 'a8782212bc94065dff632749f884ff84022d314e'

export default {
  '/': {
    FROM: 'alpine:3.22',
    steps: [
      { RUN: 'apk add --no-cache git' },
      {
        RUN: [
          'git init /src',
          'cd /src',
          'git remote add origin https://github.com/caeus/dagr-stacks.git',
          'git sparse-checkout init --cone',
          'git sparse-checkout set di',
          `git fetch --depth=1 --filter=blob:none origin ${DI_COMMIT}`,
          'git checkout --detach FETCH_HEAD',
          'rm -f /src/di/dagr.di.test.js /src/di/package.json',
        ].join(' && '),
      },
      { WORKDIR: '/src/di' },
    ],
    IGNORE: [],
  },
}
