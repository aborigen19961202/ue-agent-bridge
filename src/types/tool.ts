export interface ToolResponse {
  [key: string]: unknown;
  content: Array<
    | {
      type: "text";
      text: string;
    }
    | {
      type: "image";
      data: string;
      mimeType: string;
    }
  >;
  isError?: boolean;
}
