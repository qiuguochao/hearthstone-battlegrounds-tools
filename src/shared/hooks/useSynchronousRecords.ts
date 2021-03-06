import React from 'react';
import { useRequest, useDebounceFn } from 'ahooks';
import { createModel } from 'hox';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
import { chunk } from 'lodash';

import { records } from '@shared/db';
import useRecord from '@shared/hooks/useRecord';
import type { RecordItem } from '@shared/hooks/useStatistics';

import useAuth from './useAuth';
import { synchronousRecords, uploadRecords } from '../api';

dayjs.extend(isBetween);

const TIME = 30 * 60 * 1000;
const MAX = 30;
const SYNC_MAX = 1000;
const RANGE = 2;
// 格式化上传的数据
function formatUploadData(data: RecordItem[]) {
  return data.map((v) => ({
    _id: v._id,
    hero: {
      id: v.hero.id,
      name: v.hero.name,
    },
    rank: v.rank,
    date: v.date,
    remark: v.remark,
    lineup: v.lineup,
    synced: v.synced,
  }));
}

function useSynchronousRecords() {
  const { hasAuth } = useAuth();
  const [, { refresh }] = useRecord();
  const {
    loading: uploadLoading,
    run: uploadRun,
    cancel: uploadCancel,
  } = useRequest<RecordItem[]>(uploadRecords, {
    manual: true,
    pollingInterval: TIME,
  });
  const {
    loading: synchronousLoading,
    run: synchronousRun,
    cancel: synchronousCancel,
  } = useRequest<RecordItem[]>(synchronousRecords, {
    manual: true,
    pollingInterval: TIME,
  });

  const handleUpload = React.useCallback(
    async (data: RecordItem[]) => {
      const result = await uploadRun(data);
      if (result) {
        // eslint-disable-next-line no-restricted-syntax
        for (const item of data) {
          // eslint-disable-next-line no-await-in-loop
          await records.setUploaded(item, true);
        }
      }
    },
    [uploadRun]
  );
  const handleSynchronous = React.useCallback(
    async (data: string[]) => {
      const result = await synchronousRun(data);
      if (result) {
        await records.bulk(
          result.map((v) => Object.assign(v, { synced: true }))
        );
        refresh();
      }
    },
    // eslint-disable-next-line
    [synchronousRun]
  );
  const { run: handleSync } = useDebounceFn(
    async () => {
      if (hasAuth) {
        const now = dayjs();
        const previous = now.subtract(RANGE, 'month');

        const uploadData = await records.find({
          $where() {
            // 筛选出近2个月内且没有上传过的数据
            return (
              dayjs(this.date).isBetween(now, previous, null, '[]') &&
              !this.synced
            );
          },
        });
        if (uploadData.length > 0) {
          if (uploadData.length > MAX) {
            const chunkData = chunk(formatUploadData(uploadData), MAX);
            // eslint-disable-next-line no-restricted-syntax
            for (const c of chunkData) {
              // eslint-disable-next-line no-await-in-loop
              await handleUpload(c);
            }
          } else {
            await handleUpload(formatUploadData(uploadData));
          }
        }

        const synchronousData = await records.find({
          $where() {
            // 筛选出近2个月内的数据
            return dayjs(this.date).isBetween(now, previous, null, '[]');
          },
        });
        if (synchronousData.length > SYNC_MAX) {
          const chunkData = chunk(
            synchronousData.map((v) => v._id),
            SYNC_MAX
          );
          // eslint-disable-next-line no-restricted-syntax
          for (const c of chunkData) {
            // eslint-disable-next-line no-await-in-loop
            await handleSynchronous(c);
          }
        } else {
          await handleSynchronous(synchronousData.map((v) => v._id));
        }
        return true;
      }
      uploadCancel();
      synchronousCancel();
      return false;
    },
    { wait: 300 }
  );

  React.useEffect(() => {
    handleSync();
    // eslint-disable-next-line
  }, [hasAuth]);

  return {
    loading: uploadLoading || synchronousLoading,
    sync: handleSync,
  };
}

export default createModel(useSynchronousRecords);
