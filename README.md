# Eve Data Provider For React-Admin

## Installation

```sh
npm install --save ra-data-eve
```

## Usage

```jsx
// in src/App.js
import React from 'react';
import { Admin, Resource } from 'react-admin';
import eveDataProvider from 'ra-data-eve';

import { PostList } from './posts';

const App = () => (
    <Admin dataProvider={eveDataProvider('http://my.api.url')}>
        <Resource name="posts" list={PostList} />
    </Admin>
);

export default App;
```

## License

This data provider is licensed under the MIT License, and sponsored by [marmelab](http://marmelab.com).
