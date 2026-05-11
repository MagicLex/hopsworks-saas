import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface CardSkeletonProps {
  rows?: number;
  showIcon?: boolean;
  className?: string;
}

export default function CardSkeleton({
  rows = 3,
  showIcon = true,
  className = '',
}: CardSkeletonProps) {
  return (
    <Card className={cn('p-6', className)}>
      <div className="flex flex-col gap-3">
        {showIcon && (
          <div className="flex items-center gap-3">
            <Skeleton className="size-5" />
            <Skeleton className="h-5 w-32" />
          </div>
        )}
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-6 w-32" />
          </div>
        ))}
      </div>
    </Card>
  );
}
