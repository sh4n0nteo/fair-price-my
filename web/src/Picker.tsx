import { useId, useState, type ReactNode } from 'react'

/**
 * Search box with results as a plain list of big buttons underneath, not a floating dropdown:
 * easy to hit one-handed, never hidden behind the phone keyboard, and screen readers get
 * ordinary list and button semantics.
 */
export function Picker<T>(props: {
  label: string
  hint?: string
  placeholder: string
  search: (query: string) => T[]
  suggestions?: { heading: string; items: T[] } // shown before typing
  render: (t: T) => ReactNode
  keyOf: (t: T) => string
  onPick: (t: T) => void
  disabled?: boolean
  emptyText: string
}) {
  const id = useId()
  const [query, setQuery] = useState('')
  const results = query.trim() ? props.search(query) : []
  const showSuggestions = !query.trim() && props.suggestions && props.suggestions.items.length > 0
  const list = showSuggestions ? props.suggestions!.items : results

  return (
    <div className="picker">
      <label htmlFor={id} className="field-label">{props.label}</label>
      {props.hint && <p className="field-hint">{props.hint}</p>}
      <input
        id={id}
        className="text-input"
        type="search"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        enterKeyHint="search"
        placeholder={props.placeholder}
        value={query}
        disabled={props.disabled}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          // Enter picks the top result: one-handed typing shouldn't need a second tap.
          if (e.key === 'Enter' && results[0]) {
            e.preventDefault()
            props.onPick(results[0])
          }
        }}
      />
      {showSuggestions && <p className="list-heading">{props.suggestions!.heading}</p>}
      {list.length > 0 && (
        <ul className="choices" aria-label={showSuggestions ? props.suggestions!.heading : `Matches for ${query}`}>
          {list.map((t) => (
            <li key={props.keyOf(t)}>
              <button type="button" className="choice" onClick={() => props.onPick(t)}>
                {props.render(t)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.length === 0 && <p className="empty" role="status">{props.emptyText}</p>}
    </div>
  )
}
