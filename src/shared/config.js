'use strict';

module.exports = Object.freeze({
  gameUrl: 'https://sqweb.fun/',
  origin: 'https://sqweb.fun',
  timeouts: { navigation: 45000, battle: 10 * 60 * 1000, poll: 350 },
  channels: { status: 'assistant:status', command: 'assistant:command' },
});
