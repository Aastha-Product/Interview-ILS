// A mock Greenhouse application form for the Chrome tests, built the way Greenhouse's own is (as
// read from job-boards.greenhouse.io on 10 November 2026): React, with the real react-select for
// every drop-down (classNamePrefix "select", ids from the field names), a hidden #resume input,
// and a confirmation page at …/confirmation. What's submitted is posted to /__submitted for the
// test to check.

import { useState, type FormEvent } from "react";
import { createRoot } from "react-dom/client";
import Select from "react-select";

const COUNTRIES = ["Afghanistan", "Australia", "Brazil", "Canada", "France", "Germany", "India", "Indonesia", "Japan", "Kenya", "Nepal", "Singapore", "United Kingdom", "United States"];

const Star = ({ required }: { required?: boolean }) => (required ? <span aria-hidden="true">*</span> : null);

function Combo({ id, label, options, required, multi }: { id: string; label: string; options: string[]; required?: boolean; multi?: boolean }) {
  return (
    <div className="select__container">
      <label id={`${id}-label`} htmlFor={id} className="label select__label">
        {label}
        <Star required={required} />
      </label>
      <Select
        inputId={id}
        instanceId={id}
        name={id}
        classNamePrefix="select"
        className="select-shell"
        isMulti={multi}
        required={required}
        aria-labelledby={`${id}-label`}
        options={options.map((option) => ({ value: option, label: option }))}
      />
    </div>
  );
}

function Text({ id, label, required, type = "text" }: { id: string; label: string; required?: boolean; type?: string }) {
  return (
    <div className="text-input-wrapper">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
        <Star required={required} />
      </label>
      <input id={id} name={id} type={type} className="input input__single-line" aria-required={required ? "true" : "false"} />
    </div>
  );
}

function Application() {
  const [done, setDone] = useState(false);
  const [fileName, setFileName] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const entries: [string, string][] = [];
    for (const [key, value] of new FormData(event.currentTarget)) entries.push([key, typeof value === "string" ? value : `file:${value.name}:${value.size}`]);
    await fetch("/__submitted", { method: "POST", body: JSON.stringify(entries) });
    history.pushState(null, "", `${location.pathname}/confirmation`);
    setDone(true);
  };

  if (done)
    return (
      <div className="confirmation">
        <h1>Thank you for applying.</h1>
        <p>Your application has been received.</p>
      </div>
    );

  return (
    <form id="application-form" className="application--form" onSubmit={submit}>
      <Text id="first_name" label="First Name" required />
      <Text id="last_name" label="Last Name" required />
      <Text id="email" label="Email" required />
      <Text id="phone" label="Phone" type="tel" />
      <div className="file-upload" role="group">
        <div className="label upload-label" id="upload-label-resume">
          Resume/CV<span>*</span>
        </div>
        <button type="button" className="btn btn--pill" onClick={() => document.getElementById("resume")?.click()}>
          Attach
        </button>
        <label htmlFor="resume" className="visually-hidden">
          Attach
        </label>
        <input id="resume" name="resume" type="file" className="visually-hidden" style={{ position: "absolute", width: 1, height: 1, opacity: 0 }} onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")} />
        {fileName ? <p className="file-name">{fileName}</p> : null}
      </div>
      <Combo id="country" label="Country" options={COUNTRIES} required />
      <Combo id="question_1" label="Are you legally authorized to work in India?" options={["Yes", "No"]} required />
      <Combo id="question_2[]" label="How did you hear about us?" options={["LinkedIn", "Friend", "Other"]} required multi />
      <Combo id="4014225007" label="Sex" options={["Male", "Female", "Decline To Self Identify"]} required />
      <div className="text-input-wrapper">
        <label id="question_3-label" htmlFor="question_3">
          Why this company?
        </label>
        <textarea id="question_3" name="question_3" className="input input__multi-line" />
      </div>
      <fieldset>
        <legend>
          I agree to the privacy notice<span>*</span>
        </legend>
        <label>
          <input type="checkbox" name="question_4[]" id="question_4[]_77" value="77" required />I Agree
        </label>
      </fieldset>
      <button type="submit" className="btn btn--pill">
        Submit application
      </button>
    </form>
  );
}

createRoot(document.getElementById("root")!).render(<Application />);
