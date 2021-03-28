/**
 * @jest-environment node
 */
const EventEmitter = require('eventemitter2');
const {fundisc, seqReceived, heartbeat} = require('../fundisc');

class MockWs extends EventEmitter {
  constructor(args) {
    super(args);
  }
  send = payload => this.emit('sent', JSON.parse(payload));
}

describe('fundisc', () => {
  it('connects middleware', async () => {
    const catcher = jest.fn();
    const foo = [];

    await new Promise((resolve, reject) => {
      try {
        fundisc()
          .use(() => foo.push('foo'))
          .use(async (req, res, next) => {
            next();
            setTimeout(() => {
              foo.push('baz');
              resolve()
            }, 25);
          })
          .use(() => foo.push('bar'))
          .catch(catcher)
          .use(() => {
            throw new Error('oh noes');
          })
          .use(() => foo.push('intercepted'))
          .listen(() => new MockWs())
          .then(sendable => sendable.emit('message', '{"foo": "bar"}'));
      } catch (error) {
        reject(error);
      }
    });

    await new Promise((resolve, reject) => {
      try {
        fundisc()
          .use((req, res) => {
            foo.push('fizz');
            setTimeout(() => resolve(), 25);
            return res.end();
          }, () => {
            foo.push('buzz');
          })
          .use(() => foo.push('lorem'))
          .listen(() => new MockWs())
          .then(sendable => sendable.emit('message', '{"foo": "bar"}'));
      } catch (error) {
        reject(error);
      }
    });

    expect(foo[0]).toEqual('foo');
    expect(foo[1]).toEqual('bar');
    expect(foo[2]).toEqual('baz');
    expect(foo[3]).toEqual('fizz');
    expect(foo[4]).toBeUndefined();
    expect(catcher).toHaveBeenCalled();
  });

  it('offers middleware for handling seq', async () => {
    const seqs = [];

    await fundisc()
      .use(() => [
        () => expect(seqs.length).toBeFalsy(),
        () => expect(seqs.length).toBeTruthy()
      ][seqs.length]())
      .use(seqReceived(async seq => new Promise(resolve => setTimeout(() => {
        seqs.push(seq)
        resolve();
      }, 25))))
      .use(() => [
        () => expect(seqs[0]).toEqual(5),
        () => expect(seqs[1]).toEqual(6),
      ][seqs.length - 1]())
      .listen(() => new MockWs())
      .then(async sendable => {
        await sendable.emitAsync('message', JSON.stringify({op: 1, d: 5}));
        await sendable.emitAsync('message', JSON.stringify({op: 999, seq: 6}));
      });
  });

  it('offers middleware for handling heart beats', async () => {
    let seq = 0;

    await new Promise((resolve, reject) => {
      fundisc()
        .use(heartbeat({seq: () => seq++, onError: () => resolve()}))
        .catch(error => catcher(error))
        .listen(() => new MockWs())
        .then(sendable => new Promise((resolve, reject) => {
          sendable.on('sent', payload => {
            (payload.op === 1) && sendable.emitAsync('message', JSON.stringify({op: 11}))
              .then(() => expect(seq).toEqual(1));
          });
          sendable.emitAsync('message', JSON.stringify({op: 10, d: {heartbeat_interval: 25}}));
        }));
    });
  });
});
