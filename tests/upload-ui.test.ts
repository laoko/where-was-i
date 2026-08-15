import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToastManager } from '../src/ui/toast.ts';
import { ProgressModal } from '../src/ui/progress-modal.ts';
import { UploadZone } from '../src/ui/upload-zone.ts';
import type { IngestionProgress } from '../src/types/domain.ts';

interface MockDOMElement {
  id: string;
  className: string;
  style: Record<string, string>;
  innerHTML: string;
  textContent: string;
  appendChild: (child: unknown) => void;
  removeChild: (child: unknown) => void;
  setAttribute: (key: string, val: string) => void;
  getAttribute: (key: string) => string | null;
  querySelector: (sel: string) => MockDOMElement | null;
  querySelectorAll: (sel: string) => MockDOMElement[];
  classList: {
    add: (...tokens: string[]) => void;
    remove: (...tokens: string[]) => void;
    contains: (token: string) => boolean;
  };
  parentNode: {
    removeChild: (child: unknown) => void;
  } | null;
  click: () => void;
  onchange?: ((e: unknown) => void) | null;
  onclick?: (() => void) | null;
}

function createMockElement(): MockDOMElement {
  return {
    id: '',
    className: '',
    style: {},
    innerHTML: '',
    textContent: '',
    appendChild: vi.fn(),
    removeChild: vi.fn(),
    setAttribute: vi.fn(),
    getAttribute: vi.fn().mockReturnValue(null),
    querySelector: vi.fn().mockReturnValue({ textContent: '', style: {} }),
    querySelectorAll: vi.fn().mockReturnValue([]),
    classList: {
      add: vi.fn(),
      remove: vi.fn(),
      contains: vi.fn().mockReturnValue(false),
    },
    parentNode: {
      removeChild: vi.fn(),
    },
    click: vi.fn(),
  };
}

describe('UI Components (UploadZone, ProgressModal, ToastManager)', () => {
  beforeEach(() => {
    const mockDoc = {
      createElement: vi.fn().mockImplementation(() => createMockElement()),
      getElementById: vi.fn().mockReturnValue(null),
      body: {
        appendChild: vi.fn(),
        removeChild: vi.fn(),
      },
      addEventListener: vi.fn(),
    };

    const mockWin = {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    Object.defineProperty(globalThis, 'document', {
      value: mockDoc,
      writable: true,
      configurable: true,
    });

    Object.defineProperty(globalThis, 'window', {
      value: mockWin,
      writable: true,
      configurable: true,
    });
  });

  it('instantiates and manages ToastManager notifications', () => {
    const toast = new ToastManager();
    const element = toast.show({
      type: 'success',
      title: 'Import Successful',
      message: '100 points ingested',
    });

    expect(element).toBeDefined();
  });

  it('manages ProgressModal lifecycle stages and updates progress bar', () => {
    const onCancel = vi.fn();
    const modal = new ProgressModal({ onCancel });

    modal.show('test_file.json');

    const progress: IngestionProgress = {
      stage: 'aggregating',
      progressPercent: 65,
      pointsProcessed: 650,
      totalPoints: 1000,
      message: 'Aggregating H3 hexes',
    };

    modal.update(progress);
    modal.dismiss();
  });

  it('handles UploadZone file validation and parsing', async () => {
    const onFile = vi.fn();
    const onError = vi.fn();

    const zone = new UploadZone({
      onFileSelected: onFile,
      onError,
    });

    // Mock File object
    const validJsonFile = {
      name: 'history.json',
      type: 'application/json',
      text: vi.fn().mockResolvedValue('{"locations": []}'),
    } as unknown as File;

    await zone.processFile(validJsonFile);
    expect(onFile).toHaveBeenCalledWith('history.json', { locations: [] });

    // Invalid non-json file
    const invalidFile = {
      name: 'photo.jpg',
      type: 'image/jpeg',
      text: vi.fn().mockResolvedValue('binarydata'),
    } as unknown as File;

    await zone.processFile(invalidFile);
    expect(onError).toHaveBeenCalledWith('Please select a valid .json location history file.');
  });
});
