export type Notice = {
  type: "success" | "error" | "warning";
  message: string;
};

export type ShowNotice = (notice: Notice) => void;

export type CopyText = (text: string, label: string) => Promise<void>;
