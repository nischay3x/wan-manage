// flexiWAN SD-WAN software - flexiEdge, flexiManage.
// For more information go to https://flexiwan.com
// Copyright (C) 2021  flexiWAN Ltd.

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, either version 3 of the
// License, or (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

jest.setTimeout(40000);

const Limiter = require('../limiter');

const key = 'a';

const releaseCallback = async () => {
  return console.log('release callback');
};

const blockCallback = async () => {
  return console.log('block callback');
};

const sleep = seconds => {
  return new Promise((resolve, reject) => {
    setTimeout(() => resolve(), seconds * 1000);
  });
};

describe('Limiter functionally', () => {
  let testLimiter = null;
  beforeEach(() => {
    testLimiter = new Limiter(5, 10, 10, releaseCallback, blockCallback);
  });

  it('should be blocked before 5 times', async () => {
    for (let i = 0; i < 5; i++) {
      await sleep(1);
      await testLimiter.use(key);
    }

    const res = await testLimiter.isBlocked(key);
    expect(res).toBe(false);
  });

  it('should be blocked after 5 times', async () => {
    for (let i = 0; i < 6; i++) {
      await sleep(1);
      await testLimiter.use(key);
    }

    const res = await testLimiter.isBlocked(key);
    expect(res).toBe(true);
  });

  it('should be released after 10 seconds', async () => {
    for (let i = 0; i < 6; i++) {
      await sleep(1);
      await testLimiter.use(key);
    }

    let res = await testLimiter.isBlocked(key);
    expect(res).toBe(true);

    await sleep(11);

    res = await testLimiter.isBlocked(key);
    expect(res).toBe(false);
  });

  it('should be expired after 10 seconds without activity', async () => {
    for (let i = 0; i < 6; i++) {
      await sleep(1);
      await testLimiter.use(key);
    }

    let res = await testLimiter.isBlocked(key);
    expect(res).toBe(true);

    await sleep(11);

    res = await testLimiter.limiter.get(key);
    expect(res).toBe(null);
  });

  // test the secondary limiter
  it('should not be released after 10 seconds if still error', async () => {
    // block it quickly
    for (let i = 0; i < 6; i++) {
      await testLimiter.use(key);
    }
    // should be blocked until for 10 seconds

    await sleep(7);

    // block it quickly again
    for (let i = 0; i < 5; i++) {
      await testLimiter.use(key);
    }

    await sleep(5);

    // main limiter should be blocked even 10 seconds is over
    let res = await testLimiter.limiter.get(key);
    expect(res).not.toBe(null);

    // isBlocked should return true
    res = await testLimiter.isBlocked(key);
    expect(res).toBe(true);
  });

  // test the release functionally
  it('should not be released totally from both limiters', async () => {
    // block both limiters quickly
    for (let i = 0; i < 12; i++) {
      await testLimiter.use(key);
    }

    let res = await testLimiter.isBlocked(key);
    expect(res).toBe(true);

    // only the main should be blocked
    res = await testLimiter.isSecondaryBlocked(key);
    expect(res).toBe(false);

    await testLimiter.release(key);

    res = await testLimiter.isBlocked(key);
    expect(res).toBe(false);
    res = await testLimiter.isSecondaryBlocked(key);
    expect(res).toBe(false);

    res = await testLimiter.limiter.get(key);
    expect(res).toBe(null);
    res = await testLimiter.secondaryLimiter.get(key);
    expect(res).toBe(null);
  });

  // block callback
  it('block callback should be called', async () => {
    console.log = jest.fn();
    // block  quickly
    for (let i = 0; i < 6; i++) {
      await testLimiter.use(key);
    }

    expect(console.log).toHaveBeenCalledWith('block callback');
  });

  // release callbacks
  it('release callback should be called', async () => {
    console.log = jest.fn();
    // block  quickly
    for (let i = 0; i < 6; i++) {
      await testLimiter.use(key);
    }

    await sleep(11);

    expect(console.log).toHaveBeenCalledWith('release callback');
  });
});
