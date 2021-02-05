// const csv = require("csv");
const fs = require("fs");
const converter = require("json-2-csv");
let usernameNotFound = [];

// Gets a single comment
const getComment = async (octokit, values, issueNumber) => {
  return new Promise((resolve, reject) => {
    const issueOptions = octokit.issues.listComments.endpoint.merge({
      owner: values.userOrOrganization,
      repo: values.repo,
      issue_number: issueNumber,
    });
    octokit.paginate(issueOptions).then(
      (commentsData) => {
        resolve(commentsData);
      },
      (err) => {
        console.error(err);
        reject(err);
      }
    );
  });
};

// Given the full list of issues, appends a column for each comment. 
const getFullCommentDataJiraFormat = async (octokit, values, data, verbose = false) => {
  const fullComments = [];
  for (let i = 0; i < data.length; i++) {
    const issueObject = data[i];

    if (verbose === true) {
      console.log("getting comments for issue #: ", issueObject.number);
    }
    let commentNumber = 0
    const commentsData = await getComment(octokit, values, issueObject.number);
    commentsData.forEach((comment) => {
      commentNumber++
      let propertyName = "comment"+commentNumber
      let username = getNewUsername(values.usernameData, comment.user.login, false)
      let body = comment.body;
      if (username === "") {
        body = comment.user.login+" "+comment.body;
      }
      issueObject[propertyName] = comment.created_at+"; "+username+"; "+body
    });
    fullComments.push({
      issue: issueObject
    });
  }
  return fullComments;
};

// Given the full list of issues, returns back an array of all comments,
// each with the issue data also included.
const getFullCommentData = async (octokit, values, data, verbose = false) => {
  const fullComments = [];
  for (let i = 0; i < data.length; i++) {
    const issueObject = data[i];
    fullComments.push({
      issue: issueObject,
    });

    if (verbose === true) {
      console.log("getting comments for issue #: ", issueObject.number);
    }
    const commentsData = await getComment(octokit, values, issueObject.number);
    commentsData.forEach((comment) => {
      let username = getNewUsername(values.usernameData, comment.user.login)
      fullComments.push({
        issue: issueObject,
        comment: {
          user: username,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
          body: comment.body,
        },
      });
    });
  }
  return fullComments;
};

const writeFile = async (data, fileName = false) => {
  return new Promise((resolve, reject) => {
    converter.json2csv(
      data,
      (err, csvString) => {
        if (err) {
          reject(new Error("Invalid!"));
        }

        if (!fileName) {
          const now = new Date();
          fileName = `${now.getFullYear()}-${twoPadNumber(
            now.getMonth() + 1
          )}-${twoPadNumber(now.getDate())}-${twoPadNumber(
            now.getHours()
          )}-${twoPadNumber(now.getMinutes())}-${twoPadNumber(
            now.getSeconds()
          )}-issues.csv`;
        }
        fs.writeFile(fileName, csvString, "utf8", function (err) {
          if (err) {
            reject(new Error("Error writing the file."));
          } else {
            resolve(fileName);
          }
        });
      },
      {
        emptyFieldValue: "",
      }
    );
  });
};

const twoPadNumber = (number) => {
  return String(number).padStart(2, "0");
};

const defaultExportColumns = (data, usernameData) => {
  return data.map((issueObject) => {
    const ret = {
      number: issueObject.number,
      title: issueObject.title,
      state: issueObject.state,
      labels: "", // will be filled in below, if it exists
      milestone: "", // will be filled in below, if it exists
      user: "", // will be filled in below, if it exists
      assignee: "", // will be filled in below, if it exists
      assignees: "", // will be filled in below, if it exists
      created_at: issueObject.created_at,
      updated_at: issueObject.updated_at,
      closed_at: issueObject.closed_at !== null ? issueObject.closed_at : "",
      body: issueObject.body,
    };
    if (issueObject.user) {
      ret.user = getNewUsername(usernameData, issueObject.user.login);
      ret.watcher = ret.user;
    }
    if (issueObject.labels) {
      ret.labels = issueObject.labels
        .map((labelObject) => {
          return labelObject.name;
        })
        .join(",");
    }
    if (issueObject.assignee && issueObject.assignee.login) {
      ret.assignee = getNewUsername(usernameData, issueObject.assignee.login);
      ret.watcher2 = ret.assignee;
    }
    if (issueObject.assignees && issueObject.assignees.length > 0) {
      ret.assignees = issueObject.assignees
        .map((assigneeObject) => {
          return getNewUsername(usernameData, assigneeObject.login);
        })
        .join(",");
    }
    if (issueObject.milestone && issueObject.milestone.title) {
      ret.milestone = issueObject.milestone.title;
    }
    return ret;
  });
};

const getDataAttribute = (issueObject, attribute, usernameData) => {
  if (attribute.indexOf(".") > 0) {
    const parts = attribute.split(".");
    let currentObject = issueObject;
    parts.forEach((part) => {
      if (
        currentObject &&
        currentObject !== "" &&
        Object.prototype.hasOwnProperty.call(currentObject, part)
      ) {
        currentObject = currentObject[part];
        if (part === "login") {
          currentObject = getNewUsername(usernameData, currentObject);
        }
      } else {
        currentObject = "";
      }
    });
    return currentObject;
  } else {
    return issueObject[attribute];
  }
};

const getNewUsername = (usernameData, github_username) => {
  let userObj = usernameData.find( obj => { return obj.github_username === github_username})
    if (userObj) {
      let new_username = userObj.new_username;
      return new_username;
    } else if (usernameNotFound.indexOf(github_username) === -1) {
      usernameNotFound.push(github_username);
      return github_username;
    }
}

const specificAttributeColumns = (data, attributes, usernameData) => {
  return data.map((issueObject) => {
    const ret = {};
    attributes.forEach((attribute) => {
      ret[attribute] = getDataAttribute(issueObject, attribute, usernameData);
    });
    ret["watcher"] = ret["user.login"];
    ret["watcher2"] = ret["assignee.login"];
    return ret;
  });
};

const exportIssues = (octokit, values) => {
  // Load the username data
  if (values.usernames != "") {
    const usernameData = require(values.usernames); 
    values.usernameData = usernameData;
  } else {
    values.usernameData = [];
  }
  // Getting all the issues:
  const options = octokit.issues.listForRepo.endpoint.merge({
    owner: values.userOrOrganization,
    repo: values.repo,
    state: values.state,
  });
  octokit.paginate(options).then(
    async (data) => {
      // default export - columns that are compatible to be imported into GitHub
      let filteredData = defaultExportColumns(data, values.usernameData);
      if (values.exportAll) {
        // Just pass "data", it will flatten the JSON object we got from the API and use that (lots of data!)
        filteredData = data;
      } else if (values.exportAttributes) {
        filteredData = specificAttributeColumns(data, values.exportAttributes, values.usernameData);
      }

      // Add on comments, if requested.
      let csvData = filteredData;
      if (values.exportComments === true) {
        if (values.exportComments === true) {
          // If we want comments, replace the data that will get pushed into
          // the CSV with our full comments data:
          if (
            csvData[0] &&
            Object.prototype.hasOwnProperty.call(csvData[0], "number")
          ) {
            if (values.jiraFormat === true) {
              csvData = await getFullCommentDataJiraFormat(octokit, values, csvData, values.verbose);
            } else {
              csvData = await getFullCommentData(
                octokit,
                values,
                csvData,
                values.verbose
              );
            }
          } else {
            console.error(
              "Error: Must include issue number when exporting comments."
            );
            csvData = false;
          }
        }
      }

      // write the data out to file.
      writeFile(csvData, values.exportFileName).then(
        (fileName) => {
          console.log(`Success! check ${fileName}`);
          let unknownUserCount = usernameNotFound.length;
          if (unknownUserCount != 0) {
            console.log('the following ' + unknownUserCount + ' github users were not found in the username file:');
            console.log(usernameNotFound);
          }
          console.log(
            "❤ ❗ If this project has provided you value, please ⭐ star the repo to show your support: ➡ https://github.com/gavinr/github-csv-tools"
          );
          process.exit(0);
        },
        (err) => {
          console.log("Error writing the file. Please try again.");
          console.error(err);
          process.exit(0);
        }
      );
    },
    (err) => {
      console.log("error", err);
      process.exit(0);
    }
  );
};

module.exports = { exportIssues };
