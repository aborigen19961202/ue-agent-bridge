import { SetPropertyInput } from "../types/domain.js";
import { BridgeError } from "../utils/errors.js";

const SINGLE_PROPERTY_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export const DEFAULT_WRITABLE_PROPERTY_POLICY = {
  maxSerializedValueBytes: 8192,
  propertyNamePattern: SINGLE_PROPERTY_NAME_PATTERN
} as const;

export function assertWritablePropertyInput(input: SetPropertyInput): void {
  if (!input.target.objectPath) {
    throw new BridgeError(
      "VALIDATION_ERROR",
      "Remote Control property writes require target.objectPath. actorName-only targeting is not supported in remote-control mode."
    );
  }

  if (!DEFAULT_WRITABLE_PROPERTY_POLICY.propertyNamePattern.test(input.propertyName)) {
    throw new BridgeError(
      "VALIDATION_ERROR",
      "M0 property writes require a single explicit property name. Nested paths and broad patch writes are not allowed."
    );
  }

  const serializedValue = JSON.stringify(input.value);
  const valueBytes = Buffer.byteLength(serializedValue, "utf8");

  if (valueBytes > DEFAULT_WRITABLE_PROPERTY_POLICY.maxSerializedValueBytes) {
    throw new BridgeError(
      "VALIDATION_ERROR",
      `Property write payload is too large for M0 (${valueBytes} bytes > ${DEFAULT_WRITABLE_PROPERTY_POLICY.maxSerializedValueBytes} bytes).`
    );
  }
}
