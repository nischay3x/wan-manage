const { RateLimiterMemory } = require('rate-limiter-flexible');

class EventsLimiter {
  constructor (
    counts,
    duration,
    blockDuration,
    onRelease = async () => {},
    onBlock = async () => {}
  ) {
    this.maxCount = counts;
    this.blockDuration = blockDuration;

    this.limiter = new RateLimiterMemory({
      points: counts,
      duration: duration,
      blockDuration: blockDuration
    });

    this.secondaryLimiter = new RateLimiterMemory({
      points: counts - 1,
      duration: duration,
      blockDuration: blockDuration
    });

    this.onReleaseCallback = onRelease;
    this.onBlockCallback = onBlock;
  }

  async use (key, ...callbacksArgs) {
    try {
      // check if blocked
      const res = await this.limiter.consume(key);
      if (res.consumedPoints === 1) {
        await this.onReleaseCallback(...callbacksArgs);
      }
      return true;
    } catch (err) {
      // no more points to use - call block callback
      if (err.consumedPoints === this.maxCount + 1) {
        await this.onBlockCallback(...callbacksArgs);
      }

      // increment internal limiter
      if (err.remainingPoints <= 0) {
        try {
          await this.secondaryLimiter.consume(key);
        } catch (secondaryRes) {
          // if secondary limiter is blocked, block the main limiter and delete the internal
          await this.limiter.block(key, this.blockDuration);
          await this.secondaryLimiter.delete(key);
        }
      }

      return false;
    }
  }

  async delete (key) {
    await this.secondaryLimiter.delete(key);
    return this.limiter.delete(key);
  }

  async release (key, releaseCallback = null) {
    const isBlocked = await this.isBlocked(key);
    if (!isBlocked) {
      return false;
    }

    const isDeleted = await this.delete(key);
    if (!isDeleted) {
      return false;
    }

    // release the secondary limiter as well;
    await this.secondaryLimiter.delete(key);

    // check if override release callback passed
    if (releaseCallback) {
      await releaseCallback();
    } else {
      await this.onReleaseCallback();
    }
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

module.exports = EventsLimiter;
