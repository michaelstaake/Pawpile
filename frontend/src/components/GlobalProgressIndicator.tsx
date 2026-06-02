import { useBackgroundProgress } from "../context/BackgroundProgressContext";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatEta(seconds: number): string {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function formatPercent(loaded: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.round((loaded / total) * 100));
}

function formatEtaFromStart(loaded: number, total: number, startedAt: number | null): number | null {
  if (startedAt == null || loaded <= 0 || total <= 0) return null;
  const percent = (loaded / total) * 100;
  if (percent < 5 || loaded >= total) return null;
  return Math.max(1, Math.ceil((((total - loaded) / loaded) * Math.max(1, Date.now() - startedAt)) / 1000));
}

export default function GlobalProgressIndicator() {
  const {
    isFetching,
    fetchJobId,
    fetchProgress,
    fetchFileName,
    fetchStartedAt,
    isUploading,
    isProcessingUpload,
    uploadProgress,
    uploadStartedAt,
    uploadClock,
    uploadMode,
    cancelFetch,
    stopUpload,
  } = useBackgroundProgress();

  const hasProgress = isFetching || (isUploading && !isProcessingUpload);
  const isProcessing = isProcessingUpload || (isFetching && fetchJobId);

  if (!hasProgress && !isProcessing) {
    return null;
  }

  const uploadTotal = uploadProgress.total || uploadProgress.loaded || 0;
  const uploadPercent = formatPercent(uploadProgress.loaded, uploadTotal);
  const uploadEtaSeconds =
    uploadStartedAt != null && uploadProgress.loaded > 0 && uploadTotal > 0 && uploadPercent >= 5 && uploadProgress.loaded < uploadTotal
      ? Math.max(1, Math.ceil((((uploadTotal - uploadProgress.loaded) / uploadProgress.loaded) * Math.max(1, uploadClock - uploadStartedAt)) / 1000))
      : null;

  const fetchTotal = fetchProgress.total || 0;
  const fetchPercent = formatPercent(fetchProgress.loaded, fetchTotal);
  const fetchEtaSeconds = formatEtaFromStart(fetchProgress.loaded, fetchTotal, fetchStartedAt);

  const uploadSummaryLabel =
    uploadMode === "files" ? "Processing files..." : "Processing model...";

  return (
    <div className="fixed inset-x-0 top-0 z-[90] border-b border-black/10 bg-[#fffdf7]/95 shadow-lg backdrop-blur">
      <div className="mx-auto max-w-7xl px-4 py-3 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {isFetching ? (
              <>
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 animate-pulse rounded-full bg-amber" />
                  <span className="text-sm font-semibold text-black/80">Fetching model...</span>
                </div>
                {fetchFileName ? (
                  <span className="hidden max-w-xs truncate text-xs text-black/50 md:block" title={fetchFileName}>
                    {fetchFileName}
                  </span>
                ) : null}
              </>
            ) : null}
            {isUploading ? (
              <>
                <div className="flex items-center gap-2">
                  <div className={`h-2 w-2 ${isProcessingUpload ? "animate-pulse" : ""} rounded-full ${isProcessingUpload ? "bg-ink" : "bg-amber"}`} />
                  <span className="text-sm font-semibold text-black/80">
                    {isProcessingUpload ? "Processing..." : "Uploading..."}
                  </span>
                </div>
                {uploadSummaryLabel && isProcessingUpload ? (
                  <span className="text-xs text-black/50">{uploadSummaryLabel}</span>
                ) : null}
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            {isFetching && fetchTotal > 0 && (
              <div className="hidden items-center gap-2 md:flex">
                <span className="text-xs text-black/50">{fetchPercent}%</span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full bg-amber transition-[width]" style={{ width: `${fetchPercent}%` }} />
                </div>
                <span className="text-xs text-black/50">
                  {formatBytes(fetchProgress.loaded)} / {formatBytes(fetchTotal)}
                </span>
              </div>
            )}
            {isUploading && uploadTotal > 0 && !isProcessingUpload && (
              <div className="hidden items-center gap-2 md:flex">
                <span className="text-xs text-black/50">{uploadPercent}%</span>
                <div className="h-1.5 w-32 overflow-hidden rounded-full bg-black/10">
                  <div className="h-full rounded-full bg-amber transition-[width]" style={{ width: `${uploadPercent}%` }} />
                </div>
                <span className="text-xs text-black/50">
                  {formatBytes(uploadProgress.loaded)} / {formatBytes(uploadTotal)}
                </span>
              </div>
            )}
            <div className="hidden items-center gap-2 text-xs text-black/40 md:flex">
              {isFetching && fetchEtaSeconds != null ? (
                <span>{formatEta(fetchEtaSeconds)} remaining</span>
              ) : null}
              {isUploading && !isProcessingUpload && uploadEtaSeconds != null ? (
                <span>{formatEta(uploadEtaSeconds)} remaining</span>
              ) : null}
              {isProcessingUpload && (
                <span>Processing - this may take several minutes</span>
              )}
            </div>
            <div className="flex gap-2">
              {isFetching ? (
                <button
                  type="button"
                  onClick={cancelFetch}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                >
                  Cancel
                </button>
              ) : null}
              {isProcessingUpload ? (
                <button
                  type="button"
                  onClick={stopUpload}
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                >
                  Cancel
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {(isFetching && fetchTotal > 0) || (isUploading && uploadTotal > 0 && !isProcessingUpload) ? (
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-black/10 md:hidden">
            <div
              className={`h-full rounded-full ${isFetching ? "bg-amber" : "bg-amber"}`}
              style={{ width: `${isFetching ? fetchPercent : uploadPercent}%` }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
