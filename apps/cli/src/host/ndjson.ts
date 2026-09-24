export async function* readHostMessages(
  input: NodeJS.ReadableStream,
  maxLineBytes = 1_048_576,
): AsyncIterable<unknown> {
  let chunks: Buffer[] = [];
  let bufferedBytes = 0;

  for await (const chunk of input) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let start = 0;

    for (let i = 0; i < buf.length; i++) {
      if (bufferedBytes + (i - start) > maxLineBytes) {
        throw new Error(`Line exceeds maximum allowed size of ${maxLineBytes} bytes`);
      }

      if (buf[i] === 0x0a) {
        // Found '\n'
        const slice = buf.subarray(start, i);
        chunks.push(slice);
        bufferedBytes += slice.length;

        if (bufferedBytes > maxLineBytes) {
          throw new Error(`Line exceeds maximum allowed size of ${maxLineBytes} bytes`);
        }

        const lineBuf = Buffer.concat(chunks, bufferedBytes);
        chunks = [];
        bufferedBytes = 0;
        start = i + 1;

        let str = lineBuf.toString('utf8');
        if (str.endsWith('\r')) {
          str = str.slice(0, -1);
        }

        if (str.trim().length === 0) {
          continue;
        }

        yield JSON.parse(str);
      }
    }

    if (start < buf.length) {
      const remaining = buf.subarray(start);
      chunks.push(remaining);
      bufferedBytes += remaining.length;
      if (bufferedBytes > maxLineBytes) {
        throw new Error(`Line exceeds maximum allowed size of ${maxLineBytes} bytes`);
      }
    }
  }

  if (bufferedBytes > 0) {
    throw new Error('Unexpected EOF: incomplete line in stream');
  }
}

export async function writeHostMessage(
  output: NodeJS.WritableStream,
  message: unknown,
): Promise<void> {
  const line = JSON.stringify(message) + '\n';
  const canContinue = output.write(line, 'utf8');
  if (!canContinue) {
    await new Promise<void>((resolve, reject) => {
      const onDrain = () => {
        cleanup();
        resolve();
      };
      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };
      const cleanup = () => {
        output.off('drain', onDrain);
        output.off('error', onError);
      };
      output.on('drain', onDrain);
      output.on('error', onError);
    });
  }
}
