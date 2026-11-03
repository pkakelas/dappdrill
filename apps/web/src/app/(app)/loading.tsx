/** Shown while a page's data loads: the shape of a page header and a list, no spinner. */
export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="flex flex-col gap-3">
        <div className="skeleton h-3 w-40" />
        <div className="skeleton h-11 w-2/3 max-w-[520px]" />
        <div className="skeleton h-4 w-1/2 max-w-[380px]" />
      </div>
      <div className="flex flex-col gap-3">
        <div className="skeleton h-6 w-32" />
        <div className="list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="row">
              <div className="flex flex-1 flex-col gap-2">
                <div className="skeleton h-4 w-1/3" />
                <div className="skeleton h-3 w-1/2" />
              </div>
              <div className="skeleton h-6 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
