const { RateLimiterMemory } = require('rate-limiter-flexible');

class FwLimiter {
  constructor (counts, duration, blockDuration) {
    this.maxCount = counts;
    this.duration = duration;
    this.blockDuration = blockDuration;

    // Main limiter for a key
    this.limiter = new RateLimiterMemory({
      points: counts,
      duration: duration,
      blockDuration: blockDuration
    });

    // Secondary limiter use to counting how many times the key consumed
    // *after* it blocked by the main limiter.
    // In case it is consumed at a high rate, we block the main limiter manually
    // and reset the secondary limiter to start counting again.
    this.secondaryLimiter = new RateLimiterMemory({
      points: 9999
      // secondary limiter no need for duration and blockDuration. It use only for counting
    });
  }

  async use (key) {
    const response = { allowed: true, blockedNow: false, releasedNow: false };
    try {
      // try to consume a point. If blocked, an error will be thrown.
      const res = await this.limiter.consume(key);

      // if not blocked, delete the secondary if exists for this key.
      await this.secondaryLimiter.delete(key);

      // currently, it is not possible to pass a callback that is automatically
      // executed when the key expires.
      // So we call the release function on the next allowed time.
      if (res.consumedPoints === 1) {
        response.releasedNow = true;
      }
    } catch (err) {
      // at this point, the main limiter is blocked.
      response.allowed = false;

      // only on the first time a block is obtained for this key - call the block callback
      if (err.consumedPoints === this.maxCount + 1) {
        response.blockedNow = true;
        await this.secondaryLimiter.set(key, 0, 0);
      }

      // count how many times the locked key is used
      const resPenalty = await this.secondaryLimiter.penalty(key);
      if (resPenalty.consumedPoints === this.maxCount) {
        // if secondary limiter consumed -from the blockage time- the same points counts
        // we block the main limiter and reset the secondary.
        await this.limiter.block(key, this.blockDuration);
        await this.secondaryLimiter.set(key, 0, 0);
      }
    }

    return response;
  }

  async delete (key) {
    await this.secondaryLimiter.delete(key);
    return this.limiter.delete(key);
  }

  async release (key) {
    const isBlocked = await this.isBlocked(key);
    if (!isBlocked) {
      return false;
    }

    const isDeleted = await this.delete(key);
    if (!isDeleted) {
      return false;
    }

    // release the secondary limiter as well
    await this.secondaryLimiter.delete(key);

    return true;
  }

  async isSecondaryBlocked (key) {
    const secondaryRes = await this.secondaryLimiter.get(key);
    if (secondaryRes && secondaryRes.remainingPoints < 0) {
      return true;
    } else {
      return false;
    }
  }

  async isBlocked (key) {
    const res = await this.limiter.get(key);
    const isSecondaryBlocked = await this.isSecondaryBlocked(key);

    if (res !== null && res.remainingPoints < 0) {
      return true;
    }

    if (isSecondaryBlocked) {
      return true;
    }

    return false;
  }
};

module.exports = FwLimiter;
