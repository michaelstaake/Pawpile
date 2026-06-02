import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import { apiGet, pollUntilTaskComplete, type RunningTaskRecord } from "../lib/api";
import { useToast } from "./ToastContext";
import { type FetchProgressRecord } from "../lib/records";

type UploadProgressState = {
  loaded: number;
  total: number;
};

type BackgroundProgressState = {
  isFetching: boolean;
  fetchJobId: string | null;
  fetchProgress: UploadProgressState;
  fetchFileName: string | null;
  fetchStartedAt: number | null;
  fetchUrl: string;
  isUploading: boolean;
  isProcessingUpload: boolean;
  uploadProgress: UploadProgressState;
  uploadStartedAt: number | null;
  uploadClock: number;
  isScanning: boolean;
  uploadMode: "model" | "files";
};

const initialState: BackgroundProgressState = {
  isFetching: false,
  fetchJobId: null,
  fetchProgress: { loaded: 0, total: 0 },
  fetchFileName: null,
  fetchStartedAt: null,
  fetchUrl: "",
  isUploading: false,
  isProcessingUpload: false,
  uploadProgress: { loaded: 0, total: 0 },
  uploadStartedAt: null,
  uploadClock: Date.now(),
  isScanning: false,
  uploadMode: "model",
};

interface BackgroundProgressContextType extends BackgroundProgressState {
  startFetch: (url: string) => void;
  cancelFetch: () => void;
  startUpload: (mode: "model" | "files", totalBytes: number) => void;
  completeUploadRequest: () => void;
  transitionToProcessing: () => void;
  stopUpload: () => void;
  startScan: () => void;
  stopScan: () => void;
  updateUploadProgress: (progress: UploadProgressState) => void;
  updateUploadClock: (clock: number) => void;
  resetFetch: () => void;
  setFetchJobId: (jobId: string | null) => void;
  setFetchFileName: (fileName: string | null) => void;
  setUploadMode: (mode: "model" | "files") => void;
}

export const BackgroundProgressContext = createContext<BackgroundProgressContextType | null>(null);

export function BackgroundProgressProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const { showError, showSuccess } = useToast();
  const [state, setState] = useState<BackgroundProgressState>(initialState);
  const tokenRef = useRef(token);

  tokenRef.current = token;

  const refreshData = useCallback(async (activeToken: string) => {
    try {
      await apiGet<{ models: unknown[]; devices: unknown[]; pools: unknown[] }>(
        "/api/models?_t=" + Date.now(),
        activeToken,
      );
      window.location.reload();
    } catch {
      // Silently fail - data will refresh on next page visit
    }
  }, []);

  const startFetch = useCallback((url: string) => {
    setState((prev) => ({
      ...prev,
      isFetching: true,
      fetchJobId: null,
      fetchProgress: { loaded: 0, total: 0 },
      fetchFileName: null,
      fetchStartedAt: Date.now(),
      fetchUrl: url,
    }));
  }, []);

  const cancelFetch = useCallback(() => {
    setState((prev) => {
      if (prev.fetchJobId) {
        const t = tokenRef.current;
        if (t) {
          apiGet(`/api/models/fetch/${prev.fetchJobId}`, t).catch(() => {});
          fetch(`/api/models/fetch/${prev.fetchJobId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${t}` },
          }).catch(() => {});
        }
      }
      return {
        ...prev,
        isFetching: false,
        fetchJobId: null,
        fetchProgress: { loaded: 0, total: 0 },
        fetchFileName: null,
        fetchStartedAt: null,
        fetchUrl: "",
      };
    });
  }, []);

  const startUpload = useCallback((mode: "model" | "files", totalBytes: number) => {
    setState((prev) => ({
      ...prev,
      isUploading: true,
      isProcessingUpload: false,
      uploadProgress: { loaded: 0, total: totalBytes },
      uploadStartedAt: Date.now(),
      uploadClock: Date.now(),
      uploadMode: mode,
    }));
  }, []);

  const completeUploadRequest = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isUploading: false,
      uploadProgress: { loaded: prev.uploadProgress.total || prev.uploadProgress.loaded, total: prev.uploadProgress.total || prev.uploadProgress.loaded },
    }));
  }, []);

  const transitionToProcessing = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isProcessingUpload: true,
    }));
  }, []);

  const stopUpload = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isUploading: false,
      isProcessingUpload: false,
      uploadProgress: { loaded: 0, total: 0 },
      uploadStartedAt: null,
      uploadClock: Date.now(),
    }));
  }, []);

  const startScan = useCallback(() => {
    setState((prev) => ({ ...prev, isScanning: true }));
  }, []);

  const stopScan = useCallback(() => {
    setState((prev) => ({ ...prev, isScanning: false }));
  }, []);

  const updateUploadProgress = useCallback((progress: UploadProgressState) => {
    setState((prev) => ({ ...prev, uploadProgress: progress }));
  }, []);

  const updateUploadClock = useCallback((clock: number) => {
    setState((prev) => ({ ...prev, uploadClock: clock }));
  }, []);

  const resetFetch = useCallback(() => {
    setState((prev) => ({
      ...prev,
      isFetching: false,
      fetchJobId: null,
      fetchProgress: { loaded: 0, total: 0 },
      fetchFileName: null,
      fetchStartedAt: null,
      fetchUrl: "",
    }));
  }, []);

  const setFetchJobId = useCallback((jobId: string | null) => {
    setState((prev) => ({ ...prev, fetchJobId: jobId }));
  }, []);

  const setFetchFileName = useCallback((fileName: string | null) => {
    setState((prev) => ({ ...prev, fetchFileName: fileName }));
  }, []);

  const setUploadMode = useCallback((mode: "model" | "files") => {
    setState((prev) => ({ ...prev, uploadMode: mode }));
  }, []);

  // Fetch job progress polling
  useEffect(() => {
    if (!state.isFetching || !state.fetchJobId || !token) {
      return;
    }

    const pollFetch = async () => {
      try {
        const response = await apiGet<FetchProgressRecord>(`/api/models/fetch/${state.fetchJobId}`, token);
        setState((prev) => {
          if (prev.fetchJobId !== state.fetchJobId) return prev;
          return {
            ...prev,
            fetchProgress: { loaded: response.downloaded, total: response.total ?? 0 },
            fetchFileName: response.file_name,
          };
        });

        if (response.status === "completed") {
          setState((prev) => {
            if (prev.fetchJobId !== state.fetchJobId) return prev;
            if (response.model) {
              window.location.reload();
            }
            showSuccess("Model fetched successfully.", { id: "models-fetch-success" });
            return {
              ...prev,
              isFetching: false,
              fetchJobId: null,
              fetchProgress: { loaded: 0, total: 0 },
              fetchFileName: null,
              fetchStartedAt: null,
              fetchUrl: "",
            };
          });
          if (token) {
            setTimeout(() => refreshData(token), 500);
          }
        } else if (response.status === "error") {
          setState((prev) => {
            if (prev.fetchJobId !== state.fetchJobId) return prev;
            showError(response.error ?? "Fetch failed.", { id: "models-fetch-error" });
            return {
              ...prev,
              isFetching: false,
              fetchJobId: null,
              fetchProgress: { loaded: 0, total: 0 },
              fetchFileName: null,
              fetchStartedAt: null,
              fetchUrl: "",
            };
          });
        }
      } catch {
        setState((prev) => {
          if (prev.fetchJobId !== state.fetchJobId) return prev;
          showError("Fetch job not found or expired.", { id: "models-fetch-error" });
          return {
            ...prev,
            isFetching: false,
            fetchJobId: null,
            fetchProgress: { loaded: 0, total: 0 },
            fetchFileName: null,
            fetchStartedAt: null,
            fetchUrl: "",
          };
        });
      }
    };

    const intervalId = window.setInterval(pollFetch, 1000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [state.isFetching, state.fetchJobId, token]);

  // Upload task polling (when processing)
  useEffect(() => {
    if (!state.isProcessingUpload || !token) {
      return;
    }

    let active = true;
    let pollTimeoutId: number | null = null;
    let successShown = false;
    let errorShown = false;

    const pollTasks = async () => {
      if (!active || !tokenRef.current) return;

      try {
        const tasks = await apiGet<RunningTaskRecord[]>("/api/tasks", tokenRef.current);
        const uploadTask = tasks.find((t) => t.task_type === "model_upload");

        if (!active) return;

        if (!uploadTask) {
          if (!successShown) {
            successShown = true;
            showSuccess("Model uploaded successfully.", { id: "models-success" });
          }
          setState((prev) => {
            if (!prev.isProcessingUpload || prev.uploadMode !== state.uploadMode) return prev;
            return { ...prev, isProcessingUpload: false };
          });
          if (tokenRef.current) {
            setTimeout(() => refreshData(tokenRef.current), 500);
          }
          return;
        }

        if (uploadTask.status === "error") {
          if (!errorShown) {
            errorShown = true;
            showError(uploadTask.error ?? "Upload failed.", { id: "models-error" });
          }
          setState((prev) => {
            if (!prev.isProcessingUpload || prev.uploadMode !== state.uploadMode) return prev;
            return { ...prev, isProcessingUpload: false };
          });
          return;
        }
      } catch {
        // Silently handle poll errors
      }

      pollTimeoutId = window.setTimeout(pollTasks, 1500);
    };

    pollTimeoutId = window.setTimeout(pollTasks, 1500);

    return () => {
      active = false;
      if (pollTimeoutId) {
        window.clearTimeout(pollTimeoutId);
      }
    };
  }, [state.isProcessingUpload, state.uploadMode, token, showSuccess, showError, refreshData]);

  // Upload clock timer
  useEffect(() => {
    if (!state.isUploading) {
      return;
    }

    const intervalId = window.setInterval(() => {
      updateUploadClock(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [state.isUploading, updateUploadClock]);

  const contextValue: BackgroundProgressContextType = {
    ...state,
    startFetch,
    cancelFetch,
    startUpload,
    completeUploadRequest,
    transitionToProcessing,
    stopUpload,
    startScan,
    stopScan,
    updateUploadProgress,
    updateUploadClock,
    resetFetch,
    setFetchJobId,
    setFetchFileName,
    setUploadMode,
  };

  return (
    <BackgroundProgressContext.Provider value={contextValue}>
      {children}
    </BackgroundProgressContext.Provider>
  );
}

export function useBackgroundProgress(): BackgroundProgressContextType {
  const context = useContext(BackgroundProgressContext);
  if (!context) {
    throw new Error("useBackgroundProgress must be used within BackgroundProgressProvider");
  }
  return context;
}
