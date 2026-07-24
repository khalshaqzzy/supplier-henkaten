import { ArrowLeft, ArrowRight } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@tmmin-henkaten/ui';

export function CursorPager({
  nextCursor,
  hasNextPage,
  itemCount,
}: {
  nextCursor: string | null;
  hasNextPage: boolean;
  itemCount: number;
}) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const hasPreviousPage = params.has('cursor');

  if (!hasPreviousPage && !hasNextPage) return null;

  return (
    <nav className="cursor-pager" aria-label="Pagination">
      <span>{itemCount} data pada halaman ini</span>
      <div>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<ArrowLeft />}
          disabled={!hasPreviousPage}
          onClick={() => void navigate(-1)}
        >
          Sebelumnya
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<ArrowRight />}
          disabled={!hasNextPage || !nextCursor}
          onClick={() => {
            if (!nextCursor) return;
            const next = new URLSearchParams(params);
            next.set('cursor', nextCursor);
            setParams(next);
          }}
        >
          Berikutnya
        </Button>
      </div>
    </nav>
  );
}
