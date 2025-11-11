import React from "react";
import type { ModalProps } from "@mantine/core";
import { Modal, Stack, Text, ScrollArea, Flex, CloseButton, Button, Group, TextInput } from "@mantine/core";
import { CodeHighlight } from "@mantine/code-highlight";
import type { NodeData } from "../../../types/graph";
import useGraph from "../../editor/views/GraphView/stores/useGraph";
import useFile from "../../../store/useFile";
import { contentToJson, jsonToContent } from "../../../lib/utils/jsonAdapter";
import { FileFormat } from "../../../enums/file.enum";
import { useEffect, useState } from "react";

// return object from json removing array and object fields
const normalizeNodeData = (nodeRows: NodeData["text"]) => {
  if (!nodeRows || nodeRows.length === 0) return "{}";
  if (nodeRows.length === 1 && !nodeRows[0].key) return (`${nodeRows[0].value}`);

  const obj = {};
  nodeRows?.forEach(row => {
    // only include primitive key/value rows and skip "details" links
    if (row.type !== "array" && row.type !== "object" && row.key && row.key !== "details") {
      obj[row.key] = row.value;
    }
  });
  return JSON.stringify(obj, null, 2);
};

// return json path in the format $["customer"]
const jsonPathToString = (path?: NodeData["path"]) => {
  if (!path || path.length === 0) return "$";
  const segments = path.map(seg => (typeof seg === "number" ? seg : `"${seg}"`));
  return `$[${segments.join("][")}]`;
};

export const NodeModal = ({ opened, onClose }: ModalProps) => {
  const nodeData = useGraph(state => state.selectedNode);
  const toggleFullscreen = useGraph(state => state.toggleFullscreen);
  const getContents = useFile(state => state.getContents);
  const getFormat = useFile(state => state.getFormat);
  const setContents = useFile(state => state.setContents);

  const [editedValues, setEditedValues] = useState<Record<number, string>>({});
  const [editMode, setEditMode] = useState(false);

  useEffect(() => {
    if (!opened) return;
    const map: Record<number, string> = {};
    nodeData?.text?.forEach((row, idx) => {
      // only prepare editable primitives (has key, not complex, and not details)
      if (row.type !== "array" && row.type !== "object" && row.key && row.key !== "details") {
        map[idx] = String(row.value ?? "");
      }
    });
    setEditedValues(map);
    setEditMode(false);
  }, [opened, nodeData]);

  const setEditedValue = (idx: number, value: string) => {
    setEditedValues(prev => ({ ...prev, [idx]: value }));
  };

  const inferValue = (val: string) => {
    if (val === "") return null;
    try {
      return JSON.parse(val);
    } catch {
      if (/^-?\d+(?:\.\d+)?$/.test(val)) return Number(val);
      if (val === "true") return true;
      if (val === "false") return false;
      return val;
    }
  };

  const setAtPath = (obj: any, path: Array<string | number> | undefined, key: string | null, value: any) => {
    let target = obj;
    if (path && path.length > 0) {
      for (let i = 0; i < path.length; i++) {
        const p = path[i];
        if (target[p] === undefined) {
          target[p] = typeof path[i + 1] === "number" ? [] : {};
        }
        target = target[p];
      }
    }

    if (key === null) {
      // replace target itself
      return value;
    }

    target[key] = value;
    return obj;
  };

  const handleSave = async () => {
    try {
      const format = getFormat();
      const contents = getContents();
      const jsonObj = await contentToJson(contents, format as FileFormat);

      if (nodeData && nodeData.text.length === 1 && !nodeData.text[0].key) {
        const newVal = inferValue(editedValues[0] ?? "");
        const newObj = setAtPath(jsonObj, nodeData.path, null, newVal);
        const newContent = await jsonToContent(JSON.stringify(newObj), format as FileFormat);
        await setContents({ contents: newContent });
        onClose?.();
        return;
      }

      const updated = { ...jsonObj };
      nodeData?.text?.forEach((row, idx) => {
                if (row.type !== "array" && row.type !== "object" && row.key && row.key !== "details") {
                  const edited = editedValues[idx];
                  if (edited !== undefined) {
                    const parsed = inferValue(edited);
                    setAtPath(updated, nodeData.path, row.key, parsed);
                  }
                }
      });

      const content = await jsonToContent(JSON.stringify(updated), format as FileFormat);
      await setContents({ contents: content });
      onClose?.();
    } catch (err) {
      console.warn("Failed to save node edits", err);
    }
  };

  return (
    <Modal size="auto" opened={opened} onClose={onClose} centered withCloseButton={false}>
      <Stack pb="sm" gap="sm">
        <Stack gap="xs">
          <Flex justify="space-between" align="center">
            <Text fz="xs" fw={500}>
              Content
            </Text>
            <Group>
              <Button size="xs" variant="outline" onClick={() => setEditMode(true)}>
                Edit
              </Button>
              <CloseButton onClick={onClose} />
            </Group>
          </Flex>
          {!editMode ? (
            <ScrollArea.Autosize mah={250} maw={600}>
              <CodeHighlight
                code={normalizeNodeData(nodeData?.text ?? [])}
                miw={350}
                maw={600}
                language="json"
                withCopyButton
              />
            </ScrollArea.Autosize>
          ) : (
            <ScrollArea.Autosize mah={250} maw={600}>
              {nodeData?.text?.map((row, idx) => {
                // skip complex rows entirely in edit mode (don't show 'details' or nested JSON)
                if (row.type === "array" || row.type === "object") {
                  return null;
                }

                // skip rows without a key or the 'details' key
                if (!row.key || row.key === "details") return null;

                return (
                  <Flex key={idx} gap="sm" align="center">
                    <Text fz="sm" style={{ width: "auto" }}>
                      {row.key}
                    </Text>
                    <TextInput
                      value={editedValues[idx] ?? String(row.value ?? "")}
                      onChange={e => setEditedValue(idx, e.currentTarget.value)}
                      style={{ flex: 1 }}
                    />
                  </Flex>
                );
              })}
            </ScrollArea.Autosize>
          )}
        </Stack>
        <Text fz="xs" fw={500}>
          JSON Path
        </Text>
        <ScrollArea.Autosize maw={600}>
          <CodeHighlight
            code={jsonPathToString(nodeData?.path)}
            miw={350}
            mah={250}
            language="json"
            copyLabel="Copy to clipboard"
            copiedLabel="Copied to clipboard"
            withCopyButton
          />
        </ScrollArea.Autosize>
        {editMode ? (
          <Flex justify="flex-end" gap="sm">
            <Button
              size="xs"
              variant="outline"
                onClick={() => {
                // discard edits and exit edit mode; rebuild only primitive keyed rows
                const map: Record<number, string> = {};
                nodeData?.text?.forEach((row, idx) => {
                  if (row.type !== "array" && row.type !== "object" && row.key && row.key !== "details") {
                    map[idx] = String(row.value ?? "");
                  }
                });
                setEditedValues(map);
                setEditMode(false);
              }}
            >
              Cancel
            </Button>
            <Button
              size="xs"
              onClick={async () => {
                await handleSave();
                // after save, show updated (non-edit) view
                setEditMode(false);
              }}
            >
              Save
            </Button>
          </Flex>
        ) : null}
      </Stack>
    </Modal>
  );
};
