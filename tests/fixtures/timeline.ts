/**
 * Test fixtures for Modern Google Timeline format
 */

export const validTimelinePayload = {
  semanticSegments: [
    {
      startTime: '2024-06-15T08:00:00.000Z',
      endTime: '2024-06-15T09:30:00.000Z',
      timelinePath: [
        {
          point: 'geo:48.858844,2.294351', // Eiffel Tower, Paris
          durationMinutesOffsetMs: 0,
        },
        {
          point: 'geo:48.860611,2.337644', // Louvre Museum, Paris
          durationMinutesOffsetMs: 1800000,
        },
      ],
      activitySegment: {
        startLocation: {
          latitudeE7: 488588440,
          longitudeE7: 22943510,
        },
        endLocation: {
          latitudeE7: 488606110,
          longitudeE7: 23376440,
        },
        duration: {
          startTimestamp: '2024-06-15T08:00:00.000Z',
          endTimestamp: '2024-06-15T09:30:00.000Z',
        },
      },
    },
    {
      startTime: '2024-06-15T10:00:00.000Z',
      endTime: '2024-06-15T12:00:00.000Z',
      placeVisit: {
        location: {
          latitudeE7: 488606110,
          longitudeE7: 23376440,
        },
        duration: {
          startTimestamp: '2024-06-15T10:00:00.000Z',
          endTimestamp: '2024-06-15T12:00:00.000Z',
        },
      },
    },
  ],
};

export const emptyTimelinePayload = {
  semanticSegments: [],
};
