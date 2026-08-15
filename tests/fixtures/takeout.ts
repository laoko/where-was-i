/**
 * Test fixtures for Legacy Google Takeout format
 */

export const validTakeoutPayload = {
  locations: [
    {
      latitudeE7: 377749000,
      longitudeE7: -1224194000,
      timestampMs: '1683028800000', // 2023-05-02 12:00:00 UTC (San Francisco)
      accuracy: 15,
    },
    {
      latitudeE7: 377750000,
      longitudeE7: -1224195000,
      timestampMs: '1683032400000', // Same day, same cell or neighboring
      accuracy: 20,
    },
    {
      latitudeE7: 407128000,
      longitudeE7: -740060000,
      timestampMs: '1683115200000', // 2023-05-03 12:00:00 UTC (New York)
      accuracy: 10,
    },
  ],
};

export const takeoutWithMalformedPoints = {
  locations: [
    {
      // Valid point
      latitudeE7: 377749000,
      longitudeE7: -1224194000,
      timestampMs: '1683028800000',
    },
    {
      // Out-of-bounds latitude (95 degrees)
      latitudeE7: 950000000,
      longitudeE7: -1224194000,
      timestampMs: '1683028800000',
    },
    {
      // Out-of-bounds longitude (200 degrees)
      latitudeE7: 377749000,
      longitudeE7: 2000000000,
      timestampMs: '1683028800000',
    },
    {
      // Missing timestamp
      latitudeE7: 377749000,
      longitudeE7: -1224194000,
    },
    {
      // Not an object
      garbage: 'data',
    },
  ],
};

export const emptyTakeoutPayload = {
  locations: [],
};
