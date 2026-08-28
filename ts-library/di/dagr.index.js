const DI_COMMIT = 'b13d060f0a6708bac41486708fd713e7de7582d7'

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
        ].join(' && '),
      },
      { WORKDIR: '/src/di' },
    ],
    IGNORE: [],
  },
}
