import { stringify } from "query-string";
import {
  fetchUtils,
  GET_LIST,
  GET_ONE,
  GET_MANY,
  GET_MANY_REFERENCE,
  CREATE,
  UPDATE,
  UPDATE_MANY,
  DELETE,
  DELETE_MANY,
} from "react-admin";

const EventEmitter = require("events");

export const myDataProviderEventEmitter = new EventEmitter();

export const httpClient = (url, options = {}) => {
  options.credentials = "include";
  return fetchUtils.fetchJson(url, options);
};

/**
 * Maps react-admin queries to a PyEve powered REST API
 *
 * @see https://github.com/pyeve/eve
 * @example
 * GET_LIST     => GET http://my.api.url/posts?sort=[("title",1)]&max_results=25&page=1
 * GET_ONE      => GET http://my.api.url/posts/123
 * GET_MANY     => GET http://my.api.url/posts/123, GET http://my.api.url/posts/456, GET http://my.api.url/posts/789
 * UPDATE       => PUT http://my.api.url/posts/123
 * CREATE       => POST http://my.api.url/posts
 * DELETE       => DELETE http://my.api.url/posts/123
 */
export default (apiUrl, httpClient = fetchUtils.fetchJson) => {
  /**
   * @param {String} type One of the constants appearing at the top if this file, e.g. 'UPDATE'
   * @param {String} resource Name of the resource to fetch, e.g. 'posts'
   * @param {Object} params The data request params, depending on the type
   * @returns {Object} { url, options } The HTTP request parameters
   */
  const convertDataRequestToHTTP = (type, resource, params) => {
    let url = "";
    const options = {};
    switch (type) {
      case GET_LIST: {
        const { page, perPage } = params.pagination;
        const { field, order } = params.sort;
        const query = {
          sort: (order === "ASC" ? "" : "-") + field,
          page: page,
          max_results: perPage,
          where: JSON.stringify(params.filter),
        };
        url = `${apiUrl}/${resource}?pretty&${stringify(query)}`;
        break;
      }
      case GET_ONE:
        url = `${apiUrl}/${resource}/${params.id}?pretty`;
        break;
      case GET_MANY_REFERENCE:
        const { page, perPage } = params.pagination;
        const { field, order } = params.sort;
        const query = {
          sort: (order === "ASC" ? "" : "-") + field,
          page: page,
          max_results: perPage,
          where: JSON.stringify({
            ...params.filter,
            [params.target]: params.id,
          }),
        };
        url = `${apiUrl}/${resource}?pretty&${stringify(query)}`;
        break;
      case UPDATE:
        url = `${apiUrl}/${resource}/${params.id}?pretty`;
        options.method = "PUT";
        delete params.data.id;
        delete params.data._links;
        options.body = JSON.stringify(params.data);
        break;
      case CREATE:
        url = `${apiUrl}/${resource}?pretty`;
        options.method = "POST";
        delete params.data._links;
        options.body = JSON.stringify(params.data);
        break;
      case DELETE:
        url = `${apiUrl}/${resource}/${params.id}?pretty`;
        options.method = "DELETE";
        break;
      default:
        throw new Error(`Unsupported Data Provider request type ${type}`);
    }
    return { url, options };
  };

  /**
   * @param {Object} response HTTP response from fetch()
   * @param {String} type One of the constants appearing at the top if this file, e.g. 'UPDATE'
   * @param {String} resource Name of the resource to fetch, e.g. 'posts'
   * @param {Object} params The data request params, depending on the type
   * @returns {Object} Data response
   */
  const convertHTTPResponse = (response, type, resource, params) => {
    let { headers, json } = response;
    if (resource === "schemas" && (type === CREATE || type === UPDATE)) {
      myDataProviderEventEmitter.emit("schema_update");
    }
    switch (type) {
      case GET_LIST:
      case GET_MANY_REFERENCE:
        json._items = json._items.map((currentValue) => {
          currentValue.id = currentValue._id;
          delete currentValue._id;
          return currentValue;
        });
        return {
          data: json._items,
          total: json._meta.total,
        };
      case CREATE:
      case UPDATE:
        return { data: { ...params.data, id: json._id } };
      case DELETE:
        return { data: { id: params.id } };
      default:
        json.id = json._id;
        delete json._id;
        return { data: json };
    }
  };

  const convertFileToBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file.rawFile);

      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
    });

  /**
   * @param {string} type Request type, e.g GET_LIST
   * @param {string} resource Resource name, e.g. "posts"
   * @param {Object} payload Request parameters. Depends on the request type
   * @returns {Promise} the Promise for a data response
   */
  return async (type, resource, params) => {
    // PyEve doesn't handle filters on GET route, so we fallback to calling GET n times instead
    if (type === GET_MANY) {
      return Promise.all(
        params.ids.map((id) =>
          httpClient(`${apiUrl}/${resource}/${id}?pretty`, {})
        )
      ).then((responses) => ({
        data: responses.map((response) => {
          response.json.id = response.json._id;
          delete response.json._id;
          return response.json;
        }),
      }));
    }
    if (type === UPDATE) {
      let fields = Object.keys(params.data);
      let i = 0;
      for (i; i < fields.length; i++) {
        if (
          params.data[fields[i]] &&
          params.data[fields[i]].hasOwnProperty("rawFile")
        ) {
          if (params.data[fields[i]].src.includes("blob:http:")) {
            params.data[fields[i]].src = await convertFileToBase64(
              params.data[fields[i]]
            );
          }
        }
      }
    }
    // PyEve doesn't handle filters on UPDATE route, so we fallback to calling UPDATE n times instead
    if (type === UPDATE_MANY) {
      delete params.data.id;
      delete params.data._links;
      return Promise.all(
        params.ids.map((id) =>
          httpClient(`${apiUrl}/${resource}/${id}?pretty`, {
            method: "PATCH",
            body: JSON.stringify(params.data),
          })
        )
      ).then((responses) => ({
        data: responses.map((response) => response.json._id),
      }));
    }
    // PyEve doesn't handle filters on DELETE route, so we fallback to calling DELETE n times instead
    if (type === DELETE_MANY) {
      return Promise.all(
        params.ids.map((id) =>
          httpClient(`${apiUrl}/${resource}/${id}?pretty`, {
            method: "DELETE",
          })
        )
      ).then((responses) => ({
        data: params.ids,
      }));
    }

    const { url, options } = convertDataRequestToHTTP(type, resource, params);
    return httpClient(url, options).then((response) =>
      convertHTTPResponse(response, type, resource, params)
    );
  };
};

