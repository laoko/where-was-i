export interface UploadZoneOptions {
  onFileSelected: (filename: string, rawJson: unknown) => void;
  onError?: (message: string) => void;
}

export class UploadZone {
  private overlay: HTMLElement | null = null;
  private fileInput: HTMLInputElement | null = null;
  private options: UploadZoneOptions;
  private dragCounter = 0;

  constructor(options: UploadZoneOptions) {
    this.options = options;
    this.initDOM();
    this.attachDragEvents();
  }

  private initDOM(): void {
    if (typeof document === 'undefined') return;

    // Hidden File Input
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.json,application/json,text/json';
    this.fileInput.style.display = 'none';
    this.fileInput.onchange = (e) => {
      const target = e.target as HTMLInputElement;
      const file = target.files?.[0];
      if (file) {
        this.processFile(file);
      }
      target.value = ''; // Reset input
    };
    document.body.appendChild(this.fileInput);

    // Full-screen Drop Overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'strut-drop-overlay';
    this.overlay.innerHTML = `
      <div class="strut-drop-box">
        <span class="strut-drop-icon">🗺️</span>
        <div class="strut-drop-title">Drop Location History File</div>
        <div class="strut-drop-desc">Supports Google Takeout (Records.json) and Modern On-Device Timeline.json</div>
        <div class="strut-drop-tip">✨ 100% Client-Side: Coordinates never leave your device</div>
      </div>
    `;
    document.body.appendChild(this.overlay);
  }

  private attachDragEvents(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('dragenter', (e) => {
      e.preventDefault();
      this.dragCounter++;
      this.overlay?.classList.add('active');
    });

    window.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    window.addEventListener('dragleave', (e) => {
      e.preventDefault();
      this.dragCounter--;
      if (this.dragCounter <= 0) {
        this.dragCounter = 0;
        this.overlay?.classList.remove('active');
      }
    });

    window.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dragCounter = 0;
      this.overlay?.classList.remove('active');

      const file = e.dataTransfer?.files?.[0];
      if (file) {
        this.processFile(file);
      }
    });
  }

  /**
   * Opens the file selection dialog
   */
  openFileDialog(): void {
    this.fileInput?.click();
  }

  /**
   * Reads and parses a File as JSON safely
   */
  async processFile(file: File): Promise<void> {
    if (!file.name.toLowerCase().endsWith('.json') && file.type && !file.type.includes('json')) {
      this.options.onError?.('Please select a valid .json location history file.');
      return;
    }

    try {
      const text = await file.text();
      const rawJson: unknown = JSON.parse(text);
      this.options.onFileSelected(file.name, rawJson);
    } catch {
      this.options.onError?.(`Failed to parse ${file.name}. Ensure it is a valid JSON file.`);
    }
  }

  destroy(): void {
    if (this.overlay && this.overlay.parentNode) {
      this.overlay.parentNode.removeChild(this.overlay);
    }
    if (this.fileInput && this.fileInput.parentNode) {
      this.fileInput.parentNode.removeChild(this.fileInput);
    }
  }
}
